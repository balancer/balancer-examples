"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
const config = {
    solidity: {
        version: '0.7.1',
        settings: {
            optimizer: {
                enabled: true,
                runs: 9999,
            },
        },
    },
};
exports.default = config;
