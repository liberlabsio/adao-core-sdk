export interface aDAOProxyWithNonce {
    chainId: number;
    owners: string[];
    threshold: number;
    saltNonce: number;
}
