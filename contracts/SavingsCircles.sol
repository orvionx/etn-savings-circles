// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SavingsBadges} from "./SavingsBadges.sol";

/// @title ETN Savings Circles (v4)
/// @notice On-chain rotating savings and credit associations (ROSCAs, also known as
///         chamas, susus, tontines or stokvels) using native ETN.
///
/// How it works:
///  1. A creator sets up a circle with a fixed contribution and round length, either
///     - invite-only: a list of member addresses, or
///     - open: a number of seats that anyone can fill.
///  2. Members join by locking a security deposit equal to one contribution, with an
///     optional nickname. Nobody has a payout slot yet. Before the circle closes a
///     member can leave and get the deposit back.
///  3. When the last seat is filled the circle closes and commits to a future block.
///     Once that block exists, anyone can call drawOrder(): its hash shuffles the
///     members into payout slots and round 1 starts. Neither the creator nor the order
///     of joining has any influence on the slots.
///  4. Each round, every member contributes. When everyone has paid (or the round
///     deadline passes), anyone can settle the round and the whole pot is credited to
///     that round's recipient.
///  5. A member who misses a payment has it covered by their deposit, once. A second
///     miss by a member whose deposit is used up dissolves the circle: this round's
///     contributions and all remaining deposits are refunded.
///  6. After the last round, every remaining deposit is returned and every member
///     receives a soulbound badge NFT.
///
/// Reputation: the contract records each address's savings history (circles completed,
/// on-time and missed payments, circles dissolved by their repeated default). Open
/// circles can require a track record (N completed circles and no defaults) to join.
///
/// All payouts use the pull pattern: amounts are credited and claimed with withdraw().
contract SavingsCircles {
    enum Status { Forming, Active, Completed, Cancelled, Drawing }

    struct Circle {
        address creator;
        uint128 contribution;
        uint64 roundDuration;
        uint64 roundDeadline;
        uint32 round;       // index of the current round (0-based)
        uint32 size;        // number of seats
        uint32 joinedCount;
        uint32 paidCount;   // members who paid in the current round
        Status status;
        bool open;          // anyone may join (payout order = join order)
        uint32 minCompleted; // open circles: completed circles required to join (0 = anyone)
        uint64 drawBlock;   // block whose hash decides the payout order (0 = circle not closed yet)
        string name;
        address[] members;  // payout order once drawn (open circles: joined members only)
    }

    struct MemberState {
        bool invited;       // listed member (invite-only) or seated member (open)
        bool joined;
        bool depositUsed;
        uint32 defaults;
        uint32 lastPaidRound; // round index + 1 of the last round paid (0 = never)
        string nickname;
    }

    struct Reputation {
        uint32 joined;          // circles joined (net of leaving before the start)
        uint32 completed;       // circles completed as a member
        uint32 onTimePayments;  // contributions paid before the deadline
        uint32 missedPayments;  // contributions covered by the deposit
        uint32 defaulted;       // circles dissolved by this address's repeat miss
    }

    uint256 public constant MIN_MEMBERS = 2;
    uint256 public constant MAX_MEMBERS = 50;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_NICKNAME_LENGTH = 32;
    uint64 public constant MIN_ROUND_DURATION = 1 minutes;
    uint64 public constant MAX_ROUND_DURATION = 365 days;
    /// @notice Blocks between closing a circle and the block whose hash draws its payout order.
    uint64 public constant DRAW_DELAY = 5;

    uint256 public circleCount;
    uint256 public totalPaidOut;
    uint256 public roundsSettled;
    uint256 public circlesCompleted;

    mapping(uint256 => Circle) private circles;
    mapping(uint256 => mapping(address => MemberState)) private memberStates;
    mapping(address => uint256[]) private userCircles;
    mapping(address => uint256) public withdrawable;
    mapping(address => Reputation) private reputations;

    SavingsBadges public immutable badges;

    uint256 private locked = 1;

    event CircleCreated(uint256 indexed id, address indexed creator, string name, bool open, uint32 size, uint256 contribution, uint64 roundDuration, uint32 minCompleted);
    event MemberJoined(uint256 indexed id, address indexed member, string nickname);
    event MemberLeft(uint256 indexed id, address indexed member);
    event NicknameSet(uint256 indexed id, address indexed member, string nickname);
    event CircleClosed(uint256 indexed id, uint64 drawBlock);
    event PayoutOrderDrawn(uint256 indexed id, bytes32 seed);
    event CircleStarted(uint256 indexed id, uint64 firstDeadline);
    event Contributed(uint256 indexed id, uint32 indexed round, address indexed member);
    event DepositUsed(uint256 indexed id, uint32 indexed round, address indexed member);
    event RoundSettled(uint256 indexed id, uint32 indexed round, address indexed recipient, uint256 pot);
    event CircleCompleted(uint256 indexed id);
    event CircleCancelled(uint256 indexed id, uint32 round, address indexed defaulter);
    event Withdrawn(address indexed account, uint256 amount);
    event BadgeAwarded(uint256 indexed id, address indexed member, uint256 tokenId);

    error InvalidMemberCount();
    error InvalidContribution();
    error InvalidDuration();
    error InvalidName();
    error NicknameTooLong();
    error DuplicateMember(address member);
    error ZeroAddressMember();
    error UnknownCircle();
    error WrongStatus();
    error NotInvited();
    error NotMember();
    error AlreadyJoined();
    error WrongAmount();
    error NotCreator();
    error AlreadyPaid();
    error RoundClosed();
    error RoundStillOpen();
    error NothingToWithdraw();
    error TransferFailed();
    error Reentrancy();
    error NotEligible();
    error InvalidRequirement();
    error DrawNotReady();

    constructor() {
        badges = new SavingsBadges();
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    // ---------------------------------------------------------------- setup

    /// @notice Create an invite-only circle. The order of `members` has no effect on payouts.
    function createCircle(
        string calldata name,
        address[] calldata members,
        uint128 contribution,
        uint64 roundDuration
    ) external returns (uint256 id) {
        if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS) revert InvalidMemberCount();
        Circle storage c;
        (id, c) = _init(name, uint32(members.length), false, contribution, roundDuration, 0);

        for (uint256 i; i < members.length; ++i) {
            address m = members[i];
            if (m == address(0)) revert ZeroAddressMember();
            MemberState storage s = memberStates[id][m];
            if (s.invited) revert DuplicateMember(m);
            s.invited = true;
            c.members.push(m);
            if (m != msg.sender) userCircles[m].push(id);
        }
    }

    /// @notice Create an open circle with `size` seats. Anyone may join.
    /// @param minCompleted Track record required to join: at least this many completed
    ///        circles and no defaults. 0 lets anyone join.
    function createOpenCircle(
        string calldata name,
        uint32 size,
        uint128 contribution,
        uint64 roundDuration,
        uint32 minCompleted
    ) external returns (uint256 id) {
        if (size < MIN_MEMBERS || size > MAX_MEMBERS) revert InvalidMemberCount();
        if (minCompleted > 100) revert InvalidRequirement();
        (id, ) = _init(name, size, true, contribution, roundDuration, minCompleted);
    }

    /// @notice Join a forming circle by locking a deposit equal to one contribution.
    function join(uint256 id, string calldata nickname) external payable {
        Circle storage c = _circle(id);
        if (c.status != Status.Forming) revert WrongStatus();
        if (bytes(nickname).length > MAX_NICKNAME_LENGTH) revert NicknameTooLong();
        MemberState storage s = memberStates[id][msg.sender];
        if (s.joined) revert AlreadyJoined();
        if (msg.value != c.contribution) revert WrongAmount();

        if (c.open) {
            if (!isEligible(id, msg.sender)) revert NotEligible();
            // A forming open circle always has a free seat (it closes when full).
            s.invited = true;
            c.members.push(msg.sender);
            if (msg.sender != c.creator) userCircles[msg.sender].push(id);
        } else if (!s.invited) {
            revert NotInvited();
        }

        s.joined = true;
        s.nickname = nickname;
        ++reputations[msg.sender].joined;
        emit MemberJoined(id, msg.sender, nickname);

        if (++c.joinedCount == c.size) {
            c.status = Status.Drawing;
            c.drawBlock = uint64(block.number) + DRAW_DELAY;
            emit CircleClosed(id, c.drawBlock);
        }
    }

    /// @notice Draw the payout order of a closed circle and start round 1. Callable by
    ///         anyone once the committed block exists. The result depends only on that
    ///         block's hash, so the caller cannot influence it.
    /// @dev blockhash() only reaches back 256 blocks. If nobody drew in time, this
    ///      commits to a new future block instead, and a later call completes the draw.
    function drawOrder(uint256 id) external {
        Circle storage c = _circle(id);
        if (c.status != Status.Drawing) revert WrongStatus();
        if (block.number <= c.drawBlock) revert DrawNotReady();

        bytes32 hash = blockhash(c.drawBlock);
        if (hash == bytes32(0)) {
            c.drawBlock = uint64(block.number) + DRAW_DELAY;
            emit CircleClosed(id, c.drawBlock);
            return;
        }

        // Fisher-Yates shuffle
        bytes32 seed = keccak256(abi.encode(hash, id));
        address[] storage ms = c.members;
        for (uint256 i = ms.length - 1; i > 0; --i) {
            uint256 j = uint256(keccak256(abi.encode(seed, i))) % (i + 1);
            (ms[i], ms[j]) = (ms[j], ms[i]);
        }
        emit PayoutOrderDrawn(id, seed);

        c.status = Status.Active;
        c.roundDeadline = uint64(block.timestamp) + c.roundDuration;
        emit CircleStarted(id, c.roundDeadline);
    }

    /// @notice Leave a circle that has not closed yet. The deposit is refunded.
    function leave(uint256 id) external {
        Circle storage c = _circle(id);
        if (c.status != Status.Forming) revert WrongStatus();
        MemberState storage s = memberStates[id][msg.sender];
        if (!s.joined) revert NotMember();

        s.joined = false;
        s.nickname = "";
        --c.joinedCount;
        --reputations[msg.sender].joined;
        withdrawable[msg.sender] += c.contribution;

        if (c.open) {
            // Remove from the seat list, keeping the join order of everyone else.
            s.invited = false;
            address[] storage ms = c.members;
            uint256 n = ms.length;
            uint256 i;
            while (ms[i] != msg.sender) ++i;
            for (; i + 1 < n; ++i) ms[i] = ms[i + 1];
            ms.pop();
        }
        emit MemberLeft(id, msg.sender);
    }

    /// @notice The creator can cancel a circle that has not closed yet. Deposits are refunded.
    function cancelForming(uint256 id) external {
        Circle storage c = _circle(id);
        if (msg.sender != c.creator) revert NotCreator();
        if (c.status != Status.Forming) revert WrongStatus();
        c.status = Status.Cancelled;
        for (uint256 i; i < c.members.length; ++i) {
            address m = c.members[i];
            if (memberStates[id][m].joined) withdrawable[m] += c.contribution;
        }
        emit CircleCancelled(id, 0, address(0));
    }

    /// @notice Change your nickname in a circle you have joined.
    function setNickname(uint256 id, string calldata nickname) external {
        _circle(id);
        if (bytes(nickname).length > MAX_NICKNAME_LENGTH) revert NicknameTooLong();
        MemberState storage s = memberStates[id][msg.sender];
        if (!s.joined) revert NotMember();
        s.nickname = nickname;
        emit NicknameSet(id, msg.sender, nickname);
    }

    // ---------------------------------------------------------------- rounds

    function contribute(uint256 id) external payable {
        Circle storage c = _circle(id);
        if (c.status != Status.Active) revert WrongStatus();
        MemberState storage s = memberStates[id][msg.sender];
        if (!s.joined) revert NotMember();
        if (s.lastPaidRound == c.round + 1) revert AlreadyPaid();
        if (block.timestamp >= c.roundDeadline) revert RoundClosed();
        if (msg.value != c.contribution) revert WrongAmount();

        s.lastPaidRound = c.round + 1;
        ++c.paidCount;
        ++reputations[msg.sender].onTimePayments;
        emit Contributed(id, c.round, msg.sender);
    }

    /// @notice Settle the current round. Callable by anyone once every member has paid
    ///         or the round deadline has passed.
    function settleRound(uint256 id) external {
        Circle storage c = _circle(id);
        if (c.status != Status.Active) revert WrongStatus();
        uint256 n = c.members.length;
        if (c.paidCount < n && block.timestamp < c.roundDeadline) revert RoundStillOpen();

        uint32 round = c.round;

        if (c.paidCount < n) {
            // First pass: a repeat defaulter (deposit already spent) dissolves the circle.
            for (uint256 i; i < n; ++i) {
                address m = c.members[i];
                MemberState storage s = memberStates[id][m];
                if (s.lastPaidRound != round + 1 && s.depositUsed) {
                    _dissolve(id, c, m);
                    return;
                }
            }
            // Second pass: cover each missed payment from that member's deposit.
            for (uint256 i; i < n; ++i) {
                address m = c.members[i];
                MemberState storage s = memberStates[id][m];
                if (s.lastPaidRound == round + 1) continue;
                s.depositUsed = true;
                ++s.defaults;
                ++reputations[m].missedPayments;
                emit DepositUsed(id, round, m);
            }
        }

        address recipient = c.members[round];
        uint256 pot = uint256(c.contribution) * n;
        withdrawable[recipient] += pot;
        totalPaidOut += pot;
        ++roundsSettled;
        emit RoundSettled(id, round, recipient, pot);

        c.paidCount = 0;
        c.round = round + 1;

        if (c.round == n) {
            c.status = Status.Completed;
            ++circlesCompleted;
            _complete(id, c);
            emit CircleCompleted(id);
        } else {
            c.roundDeadline = uint64(block.timestamp) + c.roundDuration;
        }
    }

    // ---------------------------------------------------------------- payouts

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------- views

    function getCircle(uint256 id)
        external
        view
        returns (
            address creator,
            string memory name,
            uint256 contribution,
            uint64 roundDuration,
            uint64 roundDeadline,
            uint32 round,
            uint32 size,
            uint32 joinedCount,
            uint32 paidCount,
            Status status,
            bool open,
            address[] memory members
        )
    {
        Circle storage c = _circle(id);
        return (c.creator, c.name, c.contribution, c.roundDuration, c.roundDeadline, c.round,
            c.size, c.joinedCount, c.paidCount, c.status, c.open, c.members);
    }

    /// @notice Per-member details for a whole circle in one call, in payout order once drawn.
    function getMemberDetails(uint256 id)
        external
        view
        returns (
            address[] memory addrs,
            string[] memory nicknames,
            bool[] memory joined,
            bool[] memory paidThisRound,
            bool[] memory depositUsed,
            uint32[] memory defaults
        )
    {
        Circle storage c = _circle(id);
        uint256 n = c.members.length;
        addrs = c.members;
        nicknames = new string[](n);
        joined = new bool[](n);
        paidThisRound = new bool[](n);
        depositUsed = new bool[](n);
        defaults = new uint32[](n);
        bool active = c.status == Status.Active;
        for (uint256 i; i < n; ++i) {
            MemberState storage s = memberStates[id][addrs[i]];
            nicknames[i] = s.nickname;
            joined[i] = s.joined;
            paidThisRound[i] = active && s.lastPaidRound == c.round + 1;
            depositUsed[i] = s.depositUsed;
            defaults[i] = s.defaults;
        }
    }

    function getMember(uint256 id, address member)
        external
        view
        returns (bool invited, bool joined, bool depositUsed, uint32 defaults, bool paidThisRound, string memory nickname)
    {
        Circle storage c = _circle(id);
        MemberState storage s = memberStates[id][member];
        return (s.invited, s.joined, s.depositUsed, s.defaults,
            c.status == Status.Active && s.lastPaidRound == c.round + 1, s.nickname);
    }

    /// @notice Circles an account created, was invited to or joined (may contain circles it later left).
    function getUserCircles(address account) external view returns (uint256[] memory) {
        return userCircles[account];
    }

    function getReputation(address account)
        external
        view
        returns (uint32 joined, uint32 completed, uint32 onTimePayments, uint32 missedPayments, uint32 defaulted)
    {
        Reputation storage r = reputations[account];
        return (r.joined, r.completed, r.onTimePayments, r.missedPayments, r.defaulted);
    }

    /// @notice The block whose hash draws the payout order. 0 until the circle closes.
    function drawBlockOf(uint256 id) external view returns (uint64) {
        return _circle(id).drawBlock;
    }

    function nameOf(uint256 id) external view returns (string memory) {
        return _circle(id).name;
    }

    /// @notice Track record an open circle requires (completed circles, and no defaults). 0 = anyone.
    function requirementOf(uint256 id) external view returns (uint32) {
        return _circle(id).minCompleted;
    }

    /// @notice Whether `account` meets circle `id`'s track-record requirement.
    function isEligible(uint256 id, address account) public view returns (bool) {
        uint32 need = _circle(id).minCompleted;
        if (need == 0) return true;
        Reputation storage r = reputations[account];
        return r.completed >= need && r.defaulted == 0;
    }

    function currentRecipient(uint256 id) external view returns (address) {
        Circle storage c = _circle(id);
        if (c.status != Status.Active) revert WrongStatus();
        return c.members[c.round];
    }

    // ---------------------------------------------------------------- internal

    function _init(string calldata name, uint32 size, bool open, uint128 contribution, uint64 roundDuration, uint32 minCompleted)
        private
        returns (uint256 id, Circle storage c)
    {
        uint256 len = bytes(name).length;
        if (len == 0 || len > MAX_NAME_LENGTH) revert InvalidName();
        if (contribution == 0) revert InvalidContribution();
        if (roundDuration < MIN_ROUND_DURATION || roundDuration > MAX_ROUND_DURATION) revert InvalidDuration();

        id = circleCount++;
        c = circles[id];
        c.creator = msg.sender;
        c.name = name;
        c.contribution = contribution;
        c.roundDuration = roundDuration;
        c.size = size;
        c.open = open;
        c.minCompleted = minCompleted;
        userCircles[msg.sender].push(id);
        emit CircleCreated(id, msg.sender, name, open, size, contribution, roundDuration, minCompleted);
    }

    function _circle(uint256 id) private view returns (Circle storage c) {
        if (id >= circleCount) revert UnknownCircle();
        c = circles[id];
    }

    function _dissolve(uint256 id, Circle storage c, address defaulter) private {
        c.status = Status.Cancelled;
        uint32 round = c.round;
        uint256 contribution = c.contribution;
        for (uint256 i; i < c.members.length; ++i) {
            address m = c.members[i];
            MemberState storage s = memberStates[id][m];
            uint256 refund;
            if (s.lastPaidRound == round + 1) refund += contribution; // this round's payment
            if (!s.depositUsed) refund += contribution;               // unused deposit
            if (refund != 0) withdrawable[m] += refund;
        }
        ++reputations[defaulter].defaulted;
        emit CircleCancelled(id, round, defaulter);
    }

    /// @dev Last round settled: return unused deposits, record completion, award badges.
    function _complete(uint256 id, Circle storage c) private {
        uint256 n = c.members.length;
        for (uint256 i; i < n; ++i) {
            address m = c.members[i];
            MemberState storage s = memberStates[id][m];
            if (!s.depositUsed) withdrawable[m] += c.contribution;
            ++reputations[m].completed;
            uint256 tokenId = badges.mint(m, uint64(id), uint32(n), s.defaults, c.contribution);
            emit BadgeAwarded(id, m, tokenId);
        }
    }
}
