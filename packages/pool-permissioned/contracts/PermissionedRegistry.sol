// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;

import "./interfaces/IPermissionedRegistry.sol";

/**
 * @dev PermissionedRegistry is a registry of allowlists
 */
contract PermissionedRegistry is IPermissionedRegistry {
    mapping(bytes32 => address) private _allowlistOwners;
    mapping(bytes32 => mapping(address => bool)) private _allowlists;

    function createAllowlist(bytes32 allowlistId) public {
        require(_allowlistOwners[allowlistId] == address(0), "allowlist already has an owner");
        _allowlistOwners[allowlistId] = msg.sender;
    }

    function isAllowlisted(bytes32 allowlistId, address member) external view override returns (bool) {
        return _allowlists[allowlistId][member];
    }

    /**
     * @dev Adds an address to the allowlist.
     */
    function addAllowedAddress(bytes32 allowlistId, address member) external {
        require(_allowlistOwners[allowlistId] == msg.sender, "not allowlist owner");
        require(!_allowlists[allowlistId][member], "address already allowlisted");

        _allowlists[allowlistId][member] = true;
    }

    /**
     * @dev Removes an address from the allowlist.
     */
    function removeAllowedAddress(bytes32 allowlistId, address member) external {
        require(_allowlistOwners[allowlistId] == msg.sender, "not allowlist owner");

        delete _allowlists[allowlistId][member];
    }
}
