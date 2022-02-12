import { ethers } from 'hardhat';
import { MaxUint256, One } from '@ethersproject/constants';
import { parseUnits} from '@ethersproject/units';
import { formatFixed, parseFixed } from '@ethersproject/bignumber';
import { Vault, WeightedPoolFactory, WeightedPoolFactory__factory, WeightedPool__factory, WeightedPool } from '@balancer-labs/typechain';
import {
  txConfirmation,
  getBalancerContractArtifact,
} from '@balancer-examples/shared-dependencies';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { WeightedPoolEncoder, toNormalizedWeights } from '@balancer-labs/balancer-js';

// setup environment
const tokenAmount = parseFixed('100', 18);
const SCALE = parseUnits('1')

export async function deployWeightedPoolFactory(vault: Vault, deployer: SignerWithAddress): Promise<WeightedPoolFactory> {
  const { abi, bytecode } = await getBalancerContractArtifact('20210418-weighted-pool', 'WeightedPoolFactory');

  const factory = new ethers.ContractFactory(abi, bytecode, deployer);
  const instance = await factory.deploy(vault.address);
  return WeightedPoolFactory__factory.connect(instance.address, deployer);
}

export async function deployWeightedPool(
  weightedPoolFactory: WeightedPoolFactory,
  poolTokens: string[],
  trader: SignerWithAddress
): Promise<WeightedPool> {
  const name = 'My Test Balancer Pool';
  const symbol = 'POOL';
  //const normalizedWeights = [0.5, 0.5];
  const normalizedWeights = toNormalizedWeights(poolTokens.map(() => One));
  const swapFeePercentage = parseFixed('1', 12);
  const delegateOwner = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';
  const deploymentReceipt = await txConfirmation(
    weightedPoolFactory.create(name, symbol, poolTokens, normalizedWeights, swapFeePercentage, delegateOwner)
  );

  const event = deploymentReceipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }
  return WeightedPool__factory.connect(event.args?.pool, trader);
}

export async function initializeWeightedPool(poolId: string, vault: Vault, pool: WeightedPool, funder: SignerWithAddress, initialPriceData) {
  const { tokens: poolTokens } = await vault.getPoolTokens(poolId);
  const valueUSD = parseUnits('1000', 18)

  const initialPoolBalances = poolTokens.map((pt) => {
    const priceUSD = parseUnits(initialPriceData[pt].toString(), 18)
    console.log(valueUSD.toString(), priceUSD.toString());
    return valueUSD.mul(SCALE).div(priceUSD)
  })

  let userData = WeightedPoolEncoder.joinInit(initialPoolBalances);

  const joinRequest = {
    assets: poolTokens,
    maxAmountsIn: poolTokens.map(() => MaxUint256),
    userData,
    fromInternalBalance: false,
  };

  await txConfirmation(vault.connect(funder).joinPool(poolId, funder.address, funder.address, joinRequest));

  /**
   * Let's just do a quick check to see what's happened.
   * We can check the pool's balances on the vault to look at the tokens we've added and also see how much BPT we received in return
   */

  const { balances } = await vault.getPoolTokens(poolId);
  console.log(`The pool now holds:`);
  poolTokens.forEach((token, i) => {
    console.log(`  ${token}: ${formatFixed(balances[i], 18)}`);
  });

}
