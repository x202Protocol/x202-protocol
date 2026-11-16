// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title x202 agent board — public count of AI agents waiting for a company's next earnings.
/// @notice The x202 Telegram bot posts how many agents people set up for each company,
///         and how many of them are armed (funded). The site reads these numbers here.
contract X202AgentBoard {
    struct Count {
        uint32 waiting;     // agents with at least one scenario on this company
        uint32 armed;       // of which funded (0 before the token exists)
        uint64 updatedAt;   // unix seconds
    }

    address public owner;
    address public poster;
    mapping(bytes16 => Count) public counts; // ticker, e.g. "NVDA"

    event AgentsUpdated(bytes16 indexed ticker, uint32 waiting, uint32 armed, uint64 at);
    event PosterChanged(address poster);

    error NotOwner();
    error NotPoster();
    error ArmedAboveWaiting();

    constructor(address poster_) {
        owner = msg.sender;
        poster = poster_;
        emit PosterChanged(poster_);
    }

    function setPoster(address poster_) external {
        if (msg.sender != owner) revert NotOwner();
        poster = poster_;
        emit PosterChanged(poster_);
    }

    function post(bytes16 ticker, uint32 waiting, uint32 armed) external {
        if (msg.sender != poster) revert NotPoster();
        if (armed > waiting) revert ArmedAboveWaiting();
        counts[ticker] = Count(waiting, armed, uint64(block.timestamp));
        emit AgentsUpdated(ticker, waiting, armed, uint64(block.timestamp));
    }
}
