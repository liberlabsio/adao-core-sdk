# aDAO Core SDK

## Installation

Run to install:

```bash
npm i @liberlabsio/adao-core-sdk
```

Importing:

```javascript
import adaoCoreSDK from "@liberlabsio/adao-core-sdk"
```

## Usage

### 1. Wallet address

Get the address of an aDAO Wallet:

```javascript
const chainId = 1;
const owners = [
  "0x...1",
  "0x...2",
  "0x...3"
];
const threshold = 2;
const saltNonce = 0;

const walletAddress = adaoCoreSDK.getWalletProxyAddress({
  chainId,
  owners,
  threshold,
  saltNonce,
});
```

### 2. Init code

Sign calls that require master signature (after 2FA authentication usually). Custom nonce option is available if needed.

```javascript
const initCode = adaoCoreSDK.getWalletProxyInitCode({
  chainId,
  owners,
  threshold,
  saltNonce,
});
```

### 3. Dummy User Operation

In order to estimate gas values for a user operation before signatures, dummy user operation concept is introduced. We have to provide:

- **sender**: aDAO wallet address.
- **calls**: Actions to perform in the blockchain.
- **nonce**: UserOp nonce.
- **initCode**: (Optional) Only required when nonce is zero.

```javascript
const dummyUserOp = adaoCoreSDK.buildDummyUserOp(
  sender,
  calls,
  nonce,
  initCode,
);
```

*Bundler gas estimation and Paymaster signature requests are performed using dummy user operation.*

### 4. Signing

After gas and paymaster datas inclusion, a userOp is valid to be signed by its owners and sent to the Bundler for its execution:

```javascript
const userOpHash = adaoCoreSDK.getUserOpHash(
  chainId
  userOp, // includes gas values
);
const signature = await owner.signMessage(ethers.getBytes(userOpHash));
```
