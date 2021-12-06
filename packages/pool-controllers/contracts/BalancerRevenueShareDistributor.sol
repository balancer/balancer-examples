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

import "@balancer-labs/v2-vault/contracts/interfaces/IVault.sol";

import "./ScalingMath.sol";

/**
 * @author Balancer Labs
 * @title Balancer Revenue Share Distributor
 * @dev Contract to receive revenue and split it with a partner protocol.
 */
contract BalancerRevenueShareDistributor {
    using FixedPoint for uint256;

    address public constant VAULT = address(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

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
        string partner
    );
    event RevenueSharesDistributed(address indexed recipient, IERC20 indexed token, uint256 amount);

    constructor(
        address balancerAddress,
        address partnerAddress,
        uint256 partnerSharePct,
        string memory name
    ) {
        require(partnerSharePct >= 0 && partnerSharePct <= FixedPoint.ONE, "Invalid revenue share");

        // Cannot read from immutable balancerFeeRecipient here, so must store this for the event
        // Allow passing in an address for the Balancer portion (e.g., the treasury multi-sig)
        // Pass in the zero address to default to the Vault's protocol fee collector
        address feeRecipient = balancerAddress == address(0)
            ? address(IVault(VAULT).getProtocolFeesCollector())
            : balancerAddress;

        protocolFeeRecipient = feeRecipient;
        partnerFeeRecipient = partnerAddress;
        partnerRevenueSharePct = partnerSharePct;
        partnerName = name;

        emit NewRevenueShareDistributor(feeRecipient, partnerAddress, partnerSharePct, name);
    }

    /**
     * @dev Divide the balance between a partner and Balancer, according to the revenue share.
     */
    function distributeRevenueShare(IERC20 token) external virtual {
        uint256 rawTokenBalance = token.balanceOf(address(this));

        if (rawTokenBalance > 0) {
            // We don't know in advance which tokens might be sent here, so we need to calculate the scaling every time
            uint256 scalingFactor = ScalingMath.computeScalingFactor(token);
            uint256 scaledRevenueShare = ScalingMath.upscale(rawTokenBalance, scalingFactor).mulDown(
                partnerRevenueSharePct
            );
            uint256 partnerRevenueShare = ScalingMath.downscale(scaledRevenueShare, scalingFactor);

            // Transfer the tokens to both recipients
            token.transfer(partnerFeeRecipient, partnerRevenueShare);
            token.transfer(protocolFeeRecipient, token.balanceOf(address(this)));

            // Sanity check - balance should be zero after the transfers
            require(0 == token.balanceOf(address(this)), "Distribution failed");

            emit RevenueSharesDistributed(protocolFeeRecipient, token, rawTokenBalance);
        }
    }
}
