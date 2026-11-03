// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ETN Savings Circles
/// @notice On-chain rotating savings and credit associations (ROSCAs, also known as
///         chamas, susus, tontines or stokvels) using native ETN.
///
/// How it works:
///  1. A creator sets up a circle: an ordered member list (the payout order), a fixed
///     contribution amount and a round length.
///  2. Every invited member joins by locking a security deposit equal to one contribution.
///     The circle starts once all members have joined.
///  3. Each round, every member contributes. When everyone has paid (or the round
///     deadline passes), anyone can settle the round and the whole pot is credited to
///     that round's recipient.
///  4. A member who misses a payment has it covered by their deposit, once. A second
///     miss by a member whose deposit is used up dissolves the circle: this round's
///     contributions and all remaining deposits are refunded.
///  5. After the last round, every remaining deposit is returned.
///
/// All payouts use the pull pattern: amounts are credited and claimed with withdraw().
contract SavingsCircles {
    enum Status { Forming, Active, Completed, Cancelled }

    struct Circle {
        address creator;
        uint128 contribution;
        uint64 roundDuration;
        uint64 roundDeadline;
        uint32 round;       // index of the current round (0-based)
        uint32 joinedCount;
        uint32 paidCount;   // members who paid in the current round
        Status status;
        string name;
        address[] members;  // payout order
    }

    struct MemberState {
        bool invited;
        bool joined;
        bool depositUsed;
        uint32 defaults;
        uint32 lastPaidRound; // round index + 1 of the last round paid (0 = never)
    }

    uint256 public constant MIN_MEMBERS = 2;
    uint256 public constant MAX_MEMBERS = 50;
    uint64 public constant MIN_ROUND_DURATION = 1 minutes;
    uint64 public constant MAX_ROUND_DURATION = 365 days;

    uint256 public circleCount;
    mapping(uint256 => Circle) private circles;
    mapping(uint256 => mapping(address => MemberState)) private memberStates;
    mapping(address => uint256) public withdrawable;

    uint256 private locked = 1;

    event CircleCreated(uint256 indexed id, address indexed creator, string name, uint256 contribution, uint64 roundDuration, address[] members);
    event MemberJoined(uint256 indexed id, address indexed member);
    event CircleStarted(uint256 indexed id, uint64 firstDeadline);
    event Contributed(uint256 indexed id, uint32 indexed round, address indexed member);
    event DepositUsed(uint256 indexed id, uint32 indexed round, address indexed member);
    event RoundSettled(uint256 indexed id, uint32 indexed round, address indexed recipient, uint256 pot);
    event CircleCompleted(uint256 indexed id);
    event CircleCancelled(uint256 indexed id, uint32 round, address indexed defaulter);
    event Withdrawn(address indexed account, uint256 amount);

    error InvalidMemberCount();
    error InvalidContribution();
    error InvalidDuration();
    error EmptyName();
    error DuplicateMember(address member);
    error ZeroAddressMember();
    error UnknownCircle();
    error WrongStatus();
    error NotInvited();
    error AlreadyJoined();
    error WrongAmount();
    error NotCreator();
    error AlreadyPaid();
    error RoundClosed();
    error RoundStillOpen();
    error NothingToWithdraw();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    // ---------------------------------------------------------------- setup

    function createCircle(
        string calldata name,
        address[] calldata members,
        uint128 contribution,
        uint64 roundDuration
    ) external returns (uint256 id) {
        if (bytes(name).length == 0) revert EmptyName();
        if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS) revert InvalidMemberCount();
        if (contribution == 0) revert InvalidContribution();
        if (roundDuration < MIN_ROUND_DURATION || roundDuration > MAX_ROUND_DURATION) revert InvalidDuration();

        id = circleCount++;
        Circle storage c = circles[id];
        c.creator = msg.sender;
        c.name = name;
        c.contribution = contribution;
        c.roundDuration = roundDuration;

        for (uint256 i; i < members.length; ++i) {
            address m = members[i];
            if (m == address(0)) revert ZeroAddressMember();
            MemberState storage s = memberStates[id][m];
            if (s.invited) revert DuplicateMember(m);
            s.invited = true;
            c.members.push(m);
        }

        emit CircleCreated(id, msg.sender, name, contribution, roundDuration, members);
    }

    /// @notice Join a forming circle by locking a deposit equal to one contribution.
    function join(uint256 id) external payable {
        Circle storage c = _circle(id);
        if (c.status != Status.Forming) revert WrongStatus();
        MemberState storage s = memberStates[id][msg.sender];
        if (!s.invited) revert NotInvited();
        if (s.joined) revert AlreadyJoined();
        if (msg.value != c.contribution) revert WrongAmount();

        s.joined = true;
        emit MemberJoined(id, msg.sender);

        if (++c.joinedCount == c.members.length) {
            c.status = Status.Active;
            c.roundDeadline = uint64(block.timestamp) + c.roundDuration;
            emit CircleStarted(id, c.roundDeadline);
        }
    }

    /// @notice The creator can cancel a circle that has not started yet. Deposits are refunded.
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

    // ---------------------------------------------------------------- rounds

    function contribute(uint256 id) external payable {
        Circle storage c = _circle(id);
        if (c.status != Status.Active) revert WrongStatus();
        MemberState storage s = memberStates[id][msg.sender];
        if (!s.invited) revert NotInvited();
        if (s.lastPaidRound == c.round + 1) revert AlreadyPaid();
        if (block.timestamp >= c.roundDeadline) revert RoundClosed();
        if (msg.value != c.contribution) revert WrongAmount();

        s.lastPaidRound = c.round + 1;
        ++c.paidCount;
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
        uint256 contribution = c.contribution;

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
                emit DepositUsed(id, round, m);
            }
        }

        address recipient = c.members[round];
        uint256 pot = contribution * n;
        withdrawable[recipient] += pot;
        emit RoundSettled(id, round, recipient, pot);

        c.paidCount = 0;
        c.round = round + 1;

        if (c.round == n) {
            c.status = Status.Completed;
            _refundDeposits(id, c);
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
            uint32 joinedCount,
            uint32 paidCount,
            Status status,
            address[] memory members
        )
    {
        Circle storage c = _circle(id);
        return (c.creator, c.name, c.contribution, c.roundDuration, c.roundDeadline, c.round,
            c.joinedCount, c.paidCount, c.status, c.members);
    }

    function getMember(uint256 id, address member)
        external
        view
        returns (bool invited, bool joined, bool depositUsed, uint32 defaults, bool paidThisRound)
    {
        Circle storage c = _circle(id);
        MemberState storage s = memberStates[id][member];
        return (s.invited, s.joined, s.depositUsed, s.defaults,
            c.status == Status.Active && s.lastPaidRound == c.round + 1);
    }

    function currentRecipient(uint256 id) external view returns (address) {
        Circle storage c = _circle(id);
        if (c.status != Status.Active) revert WrongStatus();
        return c.members[c.round];
    }

    // ---------------------------------------------------------------- internal

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
        emit CircleCancelled(id, round, defaulter);
    }

    function _refundDeposits(uint256 id, Circle storage c) private {
        for (uint256 i; i < c.members.length; ++i) {
            address m = c.members[i];
            if (!memberStates[id][m].depositUsed) withdrawable[m] += c.contribution;
        }
    }
}
