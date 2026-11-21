import { createRoot } from "react-dom/client";
import { useState } from "react";
import ProductWorkbench from "../src/ProductWorkbench";
import CostTimePanel from "../src/CostTimePanel";
import {
  createProductDraft,
  updateProductDraft,
  applySpecifications,
} from "../src/product-domain";
import type { OperationRecord, ProductDraft } from "../src/product-types";
import "../src/style.css";
function Harness() {
  const [products, setProducts] = useState<ProductDraft[]>([]);
  const [closed, setClosed] = useState(false);
  const emptyLedger = new URLSearchParams(location.search).get("ledger");
  const records: OperationRecord[] =
    emptyLedger === "fixture"
      ? [
          {
            id: "test-operation",
            roomId: "test-room",
            name: "Test local import",
            attempt: 1,
            kind: "model-import",
            status: "succeeded",
            engine: "browser",
            submittedAt: "2026-10-29T04:00:00.000Z",
            startedAt: "2026-10-29T04:00:00.000Z",
            finishedAt: "2026-10-29T04:00:01.500Z",
            timing: { source: "local", processingMs: 1500, elapsedMs: 1500 },
            usage: { bytes: 2048 },
            cost: { basis: "local" },
          },
        ]
      : [];
  if (closed) return <div>Closed</div>;
  return emptyLedger ? (
    <CostTimePanel
      roomId="test-room"
      roomName="Test bedroom"
      operations={records}
      products={products}
      onClose={() => setClosed(true)}
    />
  ) : (
    <ProductWorkbench
      roomId="test-room"
      roomName="Test bedroom"
      original={null}
      products={products}
      session={{
        user: null,
        generation: {
          enabled: false,
          available: false,
          provider: "",
          model: "",
          estimatedCredits: null,
          creditUnit: "credits",
          remainingCredits: null,
        },
        storageAvailable: true,
      }}
      onClose={() => setClosed(true)}
      onResolve={async (input) => {
        if (input.url?.includes("failure"))
          throw new Error(
            "The store could not share this product. Your details were kept.",
          );
        let p = createProductDraft("test-room", {
          submittedUrl: input.url,
          retailer: "amazon",
        });
        p = updateProductDraft(p, { title: "Test oak desk", kind: "desk" });
        if (input.specifications)
          p = applySpecifications(p, input.specifications);
        return {
          product: p,
          notice: "Test lookup is intentionally partial.",
          operation: {
            ...records[0],
            id: "lookup",
            roomId: "test-room",
            kind: "product-lookup",
            attempt: 1,
            name: "Test lookup",
            status: "succeeded",
            engine: "test",
            submittedAt: new Date().toISOString(),
            timing: { source: "local" },
            usage: {},
            cost: { basis: "local" },
          },
        };
      }}
      onSave={(p) =>
        setProducts((old) => [...old.filter((x) => x.id !== p.id), p])
      }
      onTry={(p) => {
        (window as unknown as { tried?: ProductDraft }).tried = p;
        setClosed(true);
      }}
      onAddImage={async (p) => p}
      onImportModel={async (p) => p}
      onGenerate={async () => {
        throw new Error("Generation must stay paused");
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
