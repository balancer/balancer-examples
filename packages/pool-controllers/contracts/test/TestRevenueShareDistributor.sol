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

import "@balancer-labs/v2-solidity-utils/contracts/math/FixedPoint.sol";
import "@balancer-labs/v2-solidity-utils/contracts/math/Math.sol";
import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "@balancer-labs/v2-solidity-utils/contracts/openzeppelin/ERC20.sol";

/**
 * @author Balancer Labs
 * @title Balancer Revenue Share Distributor
 * @dev Contract to receive revenue and split it with a partner protocol.
 * //TODO This is a copy of BalancerRevenueShareDistributor, replacing the Vault call with a passed-in address.
 * If I could deploy a contract at a specific address in hardhat, I could put a mock Vault there and use the real
 * contract, but I don't know how to do that.
 */
contract TestRevenueShareDistributor {
    using FixedPoint for uint256;

    // Store the recipient addresses - call the Vault to get the Balancer ProtocolFeesCollector
    address public immutable protocolFeeRecipient;
    address public immutable partnerFeeRecipient;
    // A fixed point number corresponding to the partner's revenue share. For example, 50% = 5e17
    uint256 public immutable partnerRevenueSharePct;
    string public partnerName;

    // UI friendly way to discover all revenue share distributors and distributions
    event NewRevenueShareDistributor(
        address indexed balancerAddress,
        address indexed recipientAddress,
        uint256 revenueSharePct,
        string partnerName
    );
    event RevenueSharesDistributed(address indexed recipient, IERC20 indexed token, uint256 amount);

    constructor(
        address balancerAddress,
        address partnerAddress,
        uint256 partnerSharePct,
        string memory name
    ) {
        require(partnerSharePct >= 0 && partnerSharePct <= FixedPoint.ONE, "Invalid revenue share");

        protocolFeeRecipient = balancerAddress;
        partnerFeeRecipient = partnerAddress;
        partnerRevenueSharePct = partnerSharePct;
        partnerName = name;

        emit NewRevenueShareDistributor(balancerAddress, partnerAddress, partnerSharePct, name);
    }

    /**
     * @dev Divide the balance between a partner and Balancer, according to the revenue share.
     */
    function distributeRevenueShare(IERC20 token) external virtual {
        uint256 rawTokenBalance = token.balanceOf(address(this));

        if (rawTokenBalance > 0) {
            // We don't know in advance which tokens might be sent here, so we need to calculate the scaling every time
            uint256 scalingFactor = _computeScalingFactor(token);
            uint256 scaledRevenueShare = _upscale(rawTokenBalance, scalingFactor).mulDown(partnerRevenueSharePct);
            uint256 partnerRevenueShare = _downscale(scaledRevenueShare, scalingFactor);

            // Transfer the tokens to both recipients
            token.transfer(partnerFeeRecipient, partnerRevenueShare);
            token.transfer(protocolFeeRecipient, token.balanceOf(address(this)));

            // Sanity check - balance should be zero after the transfers
            require(0 == token.balanceOf(address(this)), "Distribution failed");

            emit RevenueSharesDistributed(protocolFeeRecipient, token, rawTokenBalance);
        }
    }

    /**
     * @dev Apply the `scalingFactor` to `amount`, resulting in full 18-decimal precision number.
     * The result is rounded down.
     */
    function _upscale(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return FixedPoint.mulDown(amount, scalingFactor);
    }

    /**
     * @dev Reverses the `scalingFactor` applied to `amount`, resulting in a smaller or equal value depending on
     * whether it needed scaling or not. The result is rounded down.
     */
    function _downscale(uint256 amount, uint256 scalingFactor) internal pure returns (uint256) {
        return FixedPoint.divDown(amount, scalingFactor);
    }

    /**
     * @dev Returns a scaling factor that, when multiplied to a token amount for `token`, normalizes its balance as if
     * it had 18 decimals.
     */
    function _computeScalingFactor(IERC20 token) internal view returns (uint256) {
        // Tokens that don't implement the `decimals` method are not supported.
        uint256 tokenDecimals = ERC20(address(token)).decimals();

        // Tokens with more than 18 decimals are not supported.
        uint256 decimalsDifference = Math.sub(18, tokenDecimals);
        return FixedPoint.ONE * 10**decimalsDifference;
    }
}
