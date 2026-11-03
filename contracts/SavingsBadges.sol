// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface ISavingsCirclesView {
    function nameOf(uint256 id) external view returns (string memory);
}

/// @title ETN Savings Circle Badges
/// @notice Soulbound (non-transferable) badges awarded to every member of a completed
///         savings circle. Metadata and artwork are generated fully on-chain.
///         Only the SavingsCircles contract that deployed this contract can mint.
contract SavingsBadges is ERC721 {
    using Strings for uint256;

    struct Badge {
        uint64 circleId;
        uint32 rounds;
        uint32 missed;
        uint64 completedAt;
        uint128 contribution;
    }

    address public immutable circles;
    uint256 public totalSupply;
    mapping(uint256 => Badge) public badges;
    mapping(address => uint256[]) private owned;

    error NotCircles();
    error Soulbound();

    constructor() ERC721("ETN Savings Circle Badge", "CIRCLE") {
        circles = msg.sender;
    }

    function mint(address to, uint64 circleId, uint32 rounds, uint32 missed, uint128 contribution)
        external
        returns (uint256 tokenId)
    {
        if (msg.sender != circles) revert NotCircles();
        tokenId = ++totalSupply;
        badges[tokenId] = Badge(circleId, rounds, missed, uint64(block.timestamp), contribution);
        owned[to].push(tokenId);
        _mint(to, tokenId); // _mint (not _safeMint): no receiver callback
    }

    /// @notice All badge ids held by `owner`.
    function tokensOf(address owner) external view returns (uint256[] memory) {
        return owned[owner];
    }

    /// @dev Block every transfer: only mints (from == address(0)) are allowed.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Badge memory b = badges[tokenId];
        string memory name = ISavingsCirclesView(circles).nameOf(b.circleId);
        string memory amount = _formatEther(b.contribution);
        string memory image = Base64.encode(bytes(_svg(tokenId, b, name, amount, b.missed == 0)));
        string memory head = string.concat(
            '{"name":"Savings Circle Badge #', tokenId.toString(),
            '","description":"Awarded for completing the savings circle \\"', _escapeJson(name),
            '\\" on Electroneum Smart Chain. Soulbound: it cannot be transferred.","image":"data:image/svg+xml;base64,', image, '",'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(head, _attributes(b, name, amount)))));
    }

    function _attributes(Badge memory b, string memory name, string memory amount) private pure returns (string memory) {
        string memory first = string.concat(
            '"attributes":[{"trait_type":"Circle","value":"', _escapeJson(name),
            '"},{"trait_type":"Circle ID","value":', uint256(b.circleId).toString(),
            '},{"trait_type":"Rounds","value":', uint256(b.rounds).toString(), "},"
        );
        return string.concat(
            first,
            '{"trait_type":"Contribution (ETN)","value":"', amount,
            '"},{"trait_type":"Missed payments","value":', uint256(b.missed).toString(),
            '},{"trait_type":"Perfect record","value":"', b.missed == 0 ? "Yes" : "No", '"}]}'
        );
    }

    function _svg(uint256 tokenId, Badge memory b, string memory name, string memory amount, bool perfect)
        private
        pure
        returns (string memory)
    {
        return string.concat(_svgHead(b.rounds), _svgName(name), _svgFoot(tokenId, b.circleId, amount, perfect));
    }

    function _svgHead(uint32 rounds) private pure returns (string memory) {
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400' font-family='Helvetica,Arial,sans-serif'>"
            "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#00c08b'/>"
            "<stop offset='.55' stop-color='#1fb6ff'/><stop offset='1' stop-color='#7c5cff'/></linearGradient></defs>"
            "<rect width='400' height='400' rx='36' fill='#0b1324'/>"
            "<circle cx='200' cy='138' r='78' fill='none' stroke='url(#g)' stroke-width='16'/>"
            "<text x='200' y='146' text-anchor='middle' fill='#fff' font-size='44' font-weight='800'>",
            uint256(rounds).toString(),
            "</text><text x='200' y='170' text-anchor='middle' fill='#9aa6c0' font-size='12' letter-spacing='2'>ROUNDS</text>"
        );
    }

    function _svgName(string memory name) private pure returns (string memory) {
        return string.concat(
            "<text x='200' y='262' text-anchor='middle' fill='#fff' font-size='22' font-weight='700'",
            bytes(name).length > 22 ? " textLength='340' lengthAdjust='spacingAndGlyphs'>" : ">",
            _escapeXml(name),
            "</text>"
        );
    }

    function _svgFoot(uint256 tokenId, uint64 circleId, string memory amount, bool perfect) private pure returns (string memory) {
        string memory lines = string.concat(
            "<text x='200' y='292' text-anchor='middle' fill='#9aa6c0' font-size='14'>Completed savings circle #",
            uint256(circleId).toString(),
            "</text><text x='200' y='318' text-anchor='middle' fill='#9aa6c0' font-size='14'>",
            amount,
            " ETN per round</text>"
        );
        return string.concat(
            lines,
            "<text x='200' y='358' text-anchor='middle' font-size='13' font-weight='700' letter-spacing='1.5' fill='",
            perfect ? "#19e0a5'>PERFECT RECORD" : "#f7c25a'>COMPLETED",
            "</text><text x='370' y='40' text-anchor='end' fill='#6d7893' font-size='12'>#",
            tokenId.toString(),
            "</text></svg>"
        );
    }

    /// @dev wei -> decimal ETN string with up to 4 decimals, trailing zeros removed.
    function _formatEther(uint256 wei_) private pure returns (string memory) {
        uint256 whole = wei_ / 1e18;
        uint256 frac = (wei_ % 1e18) / 1e14; // 4 decimals
        if (frac == 0) return whole.toString();
        bytes memory digits = bytes(frac.toString());
        bytes memory padded = new bytes(4);
        uint256 pad = 4 - digits.length;
        for (uint256 i; i < 4; ++i) padded[i] = i < pad ? bytes1("0") : digits[i - pad];
        uint256 len = 4;
        while (len > 0 && padded[len - 1] == "0") --len;
        bytes memory trimmed = new bytes(len);
        for (uint256 i; i < len; ++i) trimmed[i] = padded[i];
        return string.concat(whole.toString(), ".", string(trimmed));
    }

    function _escapeXml(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c == "&") out = abi.encodePacked(out, "&amp;");
            else if (c == "<") out = abi.encodePacked(out, "&lt;");
            else if (c == ">") out = abi.encodePacked(out, "&gt;");
            else if (c == "'") out = abi.encodePacked(out, "&#39;");
            else if (c == '"') out = abi.encodePacked(out, "&quot;");
            else if (uint8(c) < 0x20) out = abi.encodePacked(out, " ");
            else out = abi.encodePacked(out, c);
        }
        return string(out);
    }

    function _escapeJson(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c == '"') out = abi.encodePacked(out, '\\"');
            else if (c == "\\") out = abi.encodePacked(out, "\\\\");
            else if (uint8(c) < 0x20) out = abi.encodePacked(out, " ");
            else out = abi.encodePacked(out, c);
        }
        return string(out);
    }
}
