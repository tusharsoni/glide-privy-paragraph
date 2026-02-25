import { useEffect, useState } from "react";
import { usePrivy, useWallets, useSendTransaction } from "@privy-io/react-auth";
import { createSession, executeEVMSession, waitForSession } from "@paywithglide/glide-js";
import { base } from "@paywithglide/glide-js/chains";
import { usdc } from "@paywithglide/glide-js/currencies";
import { createPublicClient, http, formatUnits } from "viem";
import { base as viemBase } from "viem/chains";
import { glideConfig } from "./glideConfig";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const publicClient = createPublicClient({
  chain: viemBase,
  transport: http(),
});

function useUsdcBalance(address: string | undefined) {
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    const fetch = async () => {
      const raw = await publicClient.readContract({
        address: USDC_BASE,
        abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] }],
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      if (!cancelled) setBalance(formatUnits(raw, 6));
    };

    fetch();
    const id = setInterval(fetch, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [address]);

  return balance;
}

function App() {
  const { login, logout, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = embeddedWallet?.address as `0x${string}` | undefined;
  const currentChainId = embeddedWallet?.chainId
    ? parseInt(embeddedWallet.chainId.split(":")[1])
    : undefined;

  const usdcBalance = useUsdcBalance(walletAddress);

  const [status, setStatus] = useState<string | null>(null);

  const handleExecute = async () => {
    if (!walletAddress || !currentChainId) return;
    try {
      setStatus("Creating session...");
      const session = await createSession(glideConfig, {
        chainId: base.id,
        account: walletAddress,
        paymentCurrency: usdc.on(base),
        preferGaslessPayment: true,
        evm: {
          address: "0x6ff5693b99212da76ad316178a184ab56d299b43",
          value: 0x567558fdd3ean,
          data: "0x24856bc30000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000020b100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000400000000000000000000000006ff5693b99212da76ad316178a184ab56d299b430000000000000000000000000000000000000000000000000000567558fdd3ea00000000000000000000000000000000000000000000000000000000000003800000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000030b060e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000060000000000000000000000000420000000000000000000000000000000000000680000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000200000000000000000000000004200000000000000000000000000000000000006000000000000000000000000b530e7256a4b381953d782e4fa9e986c5a5ac4ff0000000000000000000000000000000000000000000000000000000000009c40000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000892d3c2b4abeaaf67d52a7b29783e2161b7cad40000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000b530e7256a4b381953d782e4fa9e986c5a5ac4ff00000000000000000000000072e7189b25c908e8a5ba824574176e0437b0a53e0000000000000000000000000000000000000000000000000000000000000000",
        },
      });

      setStatus("Executing session...");
      const { sponsoredTransactionHash } = await executeEVMSession(glideConfig, {
        session,
        currentChainId,
        switchChainAsync: async ({ chainId }) => {
          await embeddedWallet?.switchChain(chainId);
        },
        sendTransactionAsync: async (tx) => {
          const { hash } = await sendTransaction(
            { to: tx.to, data: tx.data, value: tx.value, chainId: tx.chainId },
            { address: walletAddress },
          );
          return hash;
        },
        signTypedDataAsync: async (data) => {
          const provider = await embeddedWallet!.getEthereumProvider();
          const sig = await provider.request({
            method: "eth_signTypedData_v4",
            params: [walletAddress, JSON.stringify(data, (_, v) => typeof v === "bigint" ? `0x${v.toString(16)}` : v)],
          });
          return sig as `0x${string}`;
        },
      });

      setStatus(`Waiting for settlement... (tx: ${sponsoredTransactionHash})`);
      const completed = await waitForSession(glideConfig, {
        sessionId: session.sessionId,
      });

      setStatus(`Done! Sponsored tx: ${completed.sponsoredTransactionHash}`);
    } catch (e: any) {
      setStatus(`Error: ${e.message || String(e)}`);
    }
  };

  return (
    <div style={{ padding: 40, fontFamily: "monospace", maxWidth: 700 }}>
      <h1>Privy + Glide</h1>

      {!authenticated ? (
        <button onClick={login}>Log in with Privy</button>
      ) : (
        <>
          <p>Wallet: {walletAddress ?? "none"}</p>
          <p>USDC on Base: {usdcBalance !== null ? `${usdcBalance} USDC` : "loading..."}</p>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={handleExecute}>Execute</button>
            <button onClick={logout}>Log out</button>
          </div>

          {status && (
            <pre style={{ wordBreak: "break-all", whiteSpace: "pre-wrap", marginTop: 16 }}>{status}</pre>
          )}
        </>
      )}
    </div>
  );
}

export default App;
