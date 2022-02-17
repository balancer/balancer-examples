import CoinGecko from 'coingecko-api';
import { BigNumber } from '@ethersproject/bignumber';

// historical price provider
export interface HistoricalPrices {
  [timestamp: number]: HistoricalPriceSnapshot;
}

export interface HistoricalPriceSnapshot {
  [tokenAddress: string]: number;
}

const CoinGeckoClient = new CoinGecko();

export async function getHistoricalPriceData(
  beginDate: Date,
  endDate: Date,
  coingeckoTokenNames: string[],
  tokenAddresses: string[]
): Promise<HistoricalPrices> {
  const prices = {};
  const correlatedPrices = [];
  const fromTimestamp = beginDate.getTime() / 1000;
  const toTimestamp = endDate.getTime() / 1000;

  for (let i = 0; i < coingeckoTokenNames.length; i++) {
    let coingeckoTokenName = coingeckoTokenNames[i];
    let tokenAddress = tokenAddresses[i];

    let result = await CoinGeckoClient.coins.fetchMarketChartRange(coingeckoTokenName, {
      from: fromTimestamp,
      to: toTimestamp,
    });

    // TODO correlate prices based on timestamp
    result.data.prices.forEach((p, idx) => {
      const priceObject = [tokenAddress, p[0], p[1]];
      if (i == 0) {
        correlatedPrices.push([priceObject]);
      } else {
        correlatedPrices[idx].push(priceObject);
      }
    });

    //result.data.prices.forEach(p => {
    //  if (prices[p[0]]) {
    //    prices[p[0]][tokenAddress] = p[1]
    //  } else {
    //    prices[p[0]] = {[tokenAddress]: p[1]}
    //  }
    //});
    await new Promise((r) => setTimeout(r, 2000));
  }

  const historicalPrices = correlatedPrices.reduce((obj, priceArray) => {
    const time = priceArray[0][1];
    obj[time] = {};

    priceArray.forEach((p) => {
      const tokenAddress = p[0];
      obj[time][tokenAddress] = p[2];
    });
    return obj;
  }, {});

  return historicalPrices;
}
