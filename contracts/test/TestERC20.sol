// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor() ERC20("TestERC20", "tERC20") {}
    function mint(uint256 _amount) public {
        _mint(msg.sender, _amount);
    }
}
