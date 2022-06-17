import { ethers } from 'hardhat';
import { BigNumber } from '@ethersproject/bignumber';
import { MaxUint256 } from '@ethersproject/constants';
import { Contract, ContractReceipt, ContractTransaction } from '@ethersproject/contracts';
import { Vault } from '@balancer-labs/typechain';
import { Dictionary, fromPairs } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import TestTokenArtifact from './artifacts/contracts/TestToken.sol/TestToken.json';
import TestWETHArtifact from './artifacts/contracts/TestWETH.sol/TestWETH.json';
import { getBalancerContractAbi, getBalancerContractBytecode } from '@balancer-labs/v2-deployments';
import { JsonFragment } from '@ethersproject/abi';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export type TokenList = Dictionary<Contract>;

export const tokenSymbols = Array.from({ length: 100 }, (_, i) => `TKN${i}`);

export async function getSigners(): Promise<{
  deployer: SignerWithAddress;
  admin: SignerWithAddress;
  creator: SignerWithAddress;
  liquidityProvider: SignerWithAddress;
  trader: SignerWithAddress;
}> {
  const [deployer, admin, creator, liquidityProvider, trader] = await ethers.getSigners();

  return { deployer, admin, creator, liquidityProvider, trader };
}

export async function txConfirmation(tx: ContractTransaction | Promise<ContractTransaction>): Promise<ContractReceipt> {
  return (await tx).wait();
}

export const getBalancerContractArtifact = async (
  task: string,
  contract: string
): Promise<{ bytecode: string; abi: JsonFragment[] }> => {
  const abi = getBalancerContractAbi(task, contract) as Promise<JsonFragment[]>;
  const bytecode = getBalancerContractBytecode(task, contract);

  return { abi: await abi, bytecode: await bytecode };
};

export async function deployVault(admin: string): Promise<Vault> {
  const [deployer] = await ethers.getSigners();
  const weth = await deployWETH(deployer);

  const authorizerArtifact = await getBalancerContractArtifact('20210418-authorizer', 'Authorizer');
  const authorizerFactory = new ethers.ContractFactory(authorizerArtifact.abi, authorizerArtifact.bytecode, deployer);
  const authorizer = await authorizerFactory.deploy(admin);

  const vaultArtifact = await getBalancerContractArtifact('20210418-vault', 'Vault');
  const vaultFactory = new ethers.ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, deployer);
  const vault = await vaultFactory.deploy(authorizer.address, weth.address, 0, 0);

  return vault as Vault;
}

export async function setupEnvironment(): Promise<{
  vault: Vault;
  tokens: TokenList;
  deployer: SignerWithAddress;
  liquidityProvider: SignerWithAddress;
  trader: SignerWithAddress;
}> {
  const { deployer, admin, creator, liquidityProvider, trader } = await getSigners();
  const vault: Vault = await deployVault(admin.address);

  const tokens = await deploySortedTokens(tokenSymbols, Array(tokenSymbols.length).fill(18));

  for (const symbol in tokens) {
    // creator tokens are used to initialize pools, but tokens are only minted when required
    await tokens[symbol].connect(creator).approve(vault.address, MaxUint256);

    // liquidity provider tokens are used to provide liquidity and not have non-zero balances
    await mintTokens(tokens, symbol, liquidityProvider, 200e18);
    await tokens[symbol].connect(liquidityProvider).approve(vault.address, MaxUint256);

    // trader tokens are used to trade and not have non-zero balances
    await mintTokens(tokens, symbol, trader, 200e18);
    await tokens[symbol].connect(trader).approve(vault.address, MaxUint256);
  }

  return { vault, tokens, deployer, liquidityProvider, trader };
}

export function pickTokenAddresses(tokens: TokenList, size: number, offset?: number): string[] {
  return tokenSymbols.slice(offset ?? 0, size + (offset ?? 0)).map((symbol) => tokens[symbol].address);
}

export async function deploySortedTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  return fromPairs(
    (await Promise.all(symbols.map((_, i) => deployToken(`T${i}`, decimals[i], deployer))))
      .sort((tokenA, tokenB) => (tokenA.address.toLowerCase() > tokenB.address.toLowerCase() ? 1 : -1))
      .map((token, index) => [symbols[index], token])
  );
}

export async function deployWETH(from?: SignerWithAddress): Promise<Contract> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  const factory = new ethers.ContractFactory(TestWETHArtifact.abi, TestWETHArtifact.bytecode, deployer);
  const instance = await factory.deploy(deployer.address);
  return instance;
}

export async function deployToken(symbol: string, decimals?: number, from?: SignerWithAddress): Promise<Contract> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  const factory = new ethers.ContractFactory(TestTokenArtifact.abi, TestTokenArtifact.bytecode, deployer);
  const instance = await factory.deploy(deployer.address, symbol, symbol, decimals);
  return instance;
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | BigNumber | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}

export function printGas(gas: number | BigNumber): string {
  if (typeof gas !== 'number') {
    gas = gas.toNumber();
  }

  return `${(gas / 1000).toFixed(1)}k`;
}
