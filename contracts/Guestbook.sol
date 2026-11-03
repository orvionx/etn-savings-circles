// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Guestbook - a simple on-chain guestbook for Electroneum Smart Chain
contract Guestbook {
    struct Entry {
        address author;
        string message;
        uint256 timestamp;
    }

    address public immutable owner;
    Entry[] private entries;

    event Signed(address indexed author, uint256 indexed id, string message);

    error EmptyMessage();
    error MessageTooLong();

    constructor(string memory firstMessage) {
        owner = msg.sender;
        _sign(firstMessage);
    }

    function sign(string calldata message) external {
        _sign(message);
    }

    function count() external view returns (uint256) {
        return entries.length;
    }

    function entry(uint256 id) external view returns (Entry memory) {
        return entries[id];
    }

    function _sign(string memory message) private {
        uint256 len = bytes(message).length;
        if (len == 0) revert EmptyMessage();
        if (len > 280) revert MessageTooLong();
        entries.push(Entry(msg.sender, message, block.timestamp));
        emit Signed(msg.sender, entries.length - 1, message);
    }
}
