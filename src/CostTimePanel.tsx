import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  Clock3,
  Download,
  Image,
  Layers3,
  PauseCircle,
  Search,
  X,
} from "lucide-react";
import {
  formatDuration,
  formatMoneyMicros,
  operationsToCsv,
  summarizeOperations,
} from "./ledger";
import { isSafeProductImageUrl } from "./product-domain";
import type {
  CostTimePanelProps,
  OperationRecord,
  ProductDraft,
} from "./product-types";
import { handleProductTabs, useProductSheetFocus } from "./ProductWorkbench";
import "./product-ui.css";

const statusLabel = (status: OperationRecord["status"]) =>
  ({
    queued: "Queued",
    running: "Processing",
    succeeded: "Completed",
    failed: "Failed",
    unknown: "Status not recorded",
  })[status];
const kindLabel = (kind: OperationRecord["kind"]) =>
  ({
    "product-lookup": "Product lookup",
    "room-analysis": "Room analysis",
    "image-preparation": "Image preparation",
    "model-generation": "3D model generation",
    "model-import": "Model import",
    "asset-download": "Asset download",
    render: "Render",
    validation: "Validation",
  })[kind];
function costText(record: OperationRecord) {
  if (record.cost.basis === "local") return "Local work · no provider charge";
  if (
    record.cost.amountMicros === null ||
    record.cost.amountMicros === undefined
  )
    return "Cost not recorded";
  return `${formatMoneyMicros(record.cost.amountMicros, record.cost.currency)} · ${record.cost.basis === "estimated" ? "estimate" : record.cost.basis === "reconciled" ? "reconciled" : "reported"}`;
}
function elapsed(record: OperationRecord, now: number) {
  if (record.timing.elapsedMs !== undefined) return record.timing.elapsedMs;
  const start = Date.parse(record.submittedAt),
    finish = record.finishedAt
      ? Date.parse(record.finishedAt)
      : ["running", "queued"].includes(record.status)
        ? now
        : NaN;
  return Number.isFinite(start) && Number.isFinite(finish)
    ? Math.max(0, finish - start)
    : undefined;
}
function dateText(value: string | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Not recorded";
}
function selectedPhoto(product: ProductDraft) {
  return (
    product.images.find((i) => i.id === product.selectedImageId) ??
    product.images[0]
  );
}
function OperationRow({
  record,
  now,
  products,
}: {
  record: OperationRecord;
  now: number;
  products: ProductDraft[];
}) {
  const product = products.find((p) => p.id === record.productId);
  const [open, setOpen] = useState(false);
  return (
    <article className={`ct-operation ${open ? "expanded" : ""}`}>
      <button
        className="ct-operation-summary"
        aria-expanded={open}
        aria-label={`Details for ${record.name}, attempt ${record.attempt}`}
        onClick={() => setOpen(!open)}
      >
        <span className={`ct-status-dot ${record.status}`} />
        <span className="ct-operation-title">
          <strong>{record.name}</strong>
          <small>
            {kindLabel(record.kind)}
            {product ? ` · ${product.title || "Untitled product"}` : ""}
          </small>
        </span>
        <span className="ct-operation-provider">
          {record.provider || record.engine}
          <small>{record.model || "Model not recorded"}</small>
        </span>
        <span className={`ct-status-label ${record.status}`}>
          {statusLabel(record.status)}
        </span>
        <span className="ct-operation-cost">
          {costText(record)}
          <small>{formatDuration(elapsed(record, now))} elapsed</small>
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="ct-operation-detail">
          <dl>
            <div>
              <dt>Provider</dt>
              <dd>{record.provider || "Local / not recorded"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{record.model || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>{record.engine || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Attempt</dt>
              <dd>{record.attempt}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{dateText(record.submittedAt)}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{dateText(record.startedAt)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{dateText(record.finishedAt)}</dd>
            </div>
            <div>
              <dt>Timing source</dt>
              <dd>{record.timing.source}</dd>
            </div>
            <div>
              <dt>Queue time</dt>
              <dd>{formatDuration(record.timing.queueMs)}</dd>
            </div>
            <div>
              <dt>Processing time</dt>
              <dd>{formatDuration(record.timing.processingMs)}</dd>
            </div>
            <div>
              <dt>Transfer time</dt>
              <dd>{formatDuration(record.timing.transferMs)}</dd>
            </div>
            <div>
              <dt>Total elapsed</dt>
              <dd>{formatDuration(elapsed(record, now))}</dd>
            </div>
            <div>
              <dt>Processing cost</dt>
              <dd>{costText(record)}</dd>
            </div>
            <div>
              <dt>Estimated credits</dt>
              <dd>
                {record.estimate
                  ? `${record.estimate.credits} ${record.estimate.creditUnit}`
                  : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt>Estimate checked</dt>
              <dd>{dateText(record.estimate?.rateCheckedAt)}</dd>
            </div>
            <div>
              <dt>Estimate rate</dt>
              <dd>{record.estimate?.rateId ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Estimate source</dt>
              <dd>{record.estimate?.rateSource ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Credits used</dt>
              <dd>
                {record.usage.credits === undefined
                  ? "Not recorded"
                  : `${record.usage.credits} ${record.usage.creditUnit || "credits"}`}
              </dd>
            </div>
            <div>
              <dt>Reserved credits</dt>
              <dd>
                {record.cost.reservedCredits === undefined
                  ? "Not recorded"
                  : `${record.cost.reservedCredits} ${record.usage.creditUnit || "credits"}`}
              </dd>
            </div>
            <div>
              <dt>Refunded credits</dt>
              <dd>
                {record.cost.refundedCredits === undefined
                  ? "Not recorded"
                  : `${record.cost.refundedCredits} ${record.usage.creditUnit || "credits"}`}
              </dd>
            </div>
            <div>
              <dt>Input / output tokens</dt>
              <dd>
                {record.usage.inputTokens ?? "—"} /{" "}
                {record.usage.outputTokens ?? "—"}
              </dd>
            </div>
            <div>
              <dt>Cached tokens</dt>
              <dd>{record.usage.cachedTokens ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Images</dt>
              <dd>
                {record.usage.imageCount ??
                  record.inputImageIds?.length ??
                  "Not recorded"}
              </dd>
            </div>
            <div>
              <dt>Data transferred</dt>
              <dd>
                {record.usage.bytes === undefined
                  ? "Not recorded"
                  : `${(record.usage.bytes / 1024).toFixed(1)} KB`}
              </dd>
            </div>
          </dl>
          {record.cost.note && <p className="pw-hint">{record.cost.note}</p>}
          {record.errorCode && (
            <p className="pw-warning">
              This attempt did not complete: {record.errorCode}
            </p>
          )}
          {record.reusedFrom && (
            <p className="pw-hint">
              An existing result was reused for this operation.
            </p>
          )}
          {record.cost.rateId && (
            <p className="pw-hint">Recorded rate: {record.cost.rateId}</p>
          )}
        </div>
      )}
    </article>
  );
}
export default function CostTimePanel({
  storageNote,
  operations,
  products,
  roomId,
  roomName,
  onClose,
}: CostTimePanelProps) {
  const [tab, setTab] = useState<
    "overview" | "images" | "components" | "activity"
  >("overview");
  const [scope, setScope] = useState<"room" | "all">("room");
  const [status, setStatus] = useState("all"),
    [provider, setProvider] = useState("all"),
    [model, setModel] = useState("all"),
    [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());
  const sheet = useRef<HTMLDivElement>(null);
  useProductSheetFocus(sheet);
  useEffect(() => {
    if (
      !operations.some((r) => r.status === "running" || r.status === "queued")
    )
      return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [operations]);
  const scoped = operations.filter(
    (r) => scope === "all" || r.roomId === roomId,
  );
  const providers = [
    ...new Set(scoped.map((r) => r.provider || r.engine).filter(Boolean)),
  ].sort();
  const models = [
    ...new Set(
      scoped.map((r) => r.model).filter((x): x is string => Boolean(x)),
    ),
  ].sort();
  const records = useMemo(
    () =>
      scoped
        .filter(
          (r) =>
            (status === "all" || r.status === status) &&
            (provider === "all" || (r.provider || r.engine) === provider) &&
            (model === "all" || r.model === model) &&
            (!query.trim() ||
              [r.name, r.provider, r.model, r.engine, kindLabel(r.kind)]
                .join(" ")
                .toLowerCase()
                .includes(query.trim().toLowerCase())),
        )
        .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)),
    [operations, scope, roomId, status, provider, model, query],
  );
  const summary = summarizeOperations(records);
  const reportedMoney = summary.money.filter((m) =>
    records.some(
      (r) =>
        r.cost.currency === m.currency &&
        ["reported", "reconciled"].includes(r.cost.basis) &&
        r.cost.amountMicros != null,
    ),
  );
  const usedCredits = summary.credits.filter((c) =>
    records.some(
      (r) => r.usage.creditUnit === c.unit && r.usage.credits !== undefined,
    ),
  );
  const hasMoneyBasis = (currency: string, basis: "estimated" | "reported") =>
    records.some(
      (r) =>
        r.cost.currency === currency &&
        r.cost.amountMicros != null &&
        (basis === "estimated"
          ? r.cost.basis === "estimated"
          : ["reported", "reconciled"].includes(r.cost.basis)),
    );
  const visibleProducts = products.filter(
    (p) => scope === "all" || p.roomId === roomId,
  );
  const images = visibleProducts.flatMap((product) =>
    product.images.map((image) => ({
      product,
      image,
      records: records.filter((r) => r.inputImageIds?.includes(image.id)),
    })),
  );
  const componentGroups = [
    ...new Set(
      records
        .map((r) => r.componentId || r.productId)
        .filter((x): x is string => Boolean(x)),
    ),
  ].map((id) => ({
    id,
    records: records.filter((r) => (r.componentId || r.productId) === id),
  }));
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([operationsToCsv(records)], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `roomshift-processing-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const recordList = (items: OperationRecord[]) =>
    items.map((record) => (
      <OperationRow
        key={record.id}
        record={record}
        now={now}
        products={products}
      />
    ));
  return (
    <div
      className="product-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="product-sheet cost-time-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cost-time-title"
        ref={sheet}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (
            e.key === "Delete" ||
            e.key === "Backspace" ||
            ((e.ctrlKey || e.metaKey) &&
              ["z", "y"].includes(e.key.toLowerCase()))
          )
            e.stopPropagation();
          if (
            e.key === "Escape" &&
            !(e.target as HTMLElement).closest("input,textarea,select")
          ) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="product-sheet-header">
          <div>
            <span className="pw-eyebrow">EVERY STEP, IN VIEW</span>
            <h2 id="cost-time-title">Cost & time</h2>
            <p>Processing usage for your rooms, images and furniture.</p>
          </div>
          <button
            className="pw-icon-button"
            aria-label="Close cost and time"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <nav className="pw-tabs" role="tablist" aria-label="Cost and time views" onKeyDown={handleProductTabs}>
          {(
            [
              ["overview", "Overview", Clock3],
              ["images", "Images", Image],
              ["components", "Components", Layers3],
              ["activity", "Activity", Activity],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
        <div className="product-sheet-scroll ct-scroll" role="tabpanel" id="ct-tabpanel" aria-labelledby={`ct-tab-${tab}`}>
          <div className="ct-toolbar">
            <label className="pw-field">
              <span>Show usage for</span>
              <select
                aria-label="Usage room scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
              >
                <option value="room">This room · {roomName}</option>
                <option value="all">All my rooms</option>
              </select>
            </label>
            <button
              className="pw-button pw-secondary"
              disabled={!records.length}
              onClick={download}
            >
              <Download size={15} /> Export CSV
            </button>
          </div>
          <div className="ct-filters">
            <label className="ct-search">
              <Search size={15} />
              <input
                aria-label="Search processing activity"
                value={query}
                placeholder="Search activity"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter processing status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              {(
                ["queued", "running", "succeeded", "failed", "unknown"] as const
              ).map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter processing provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="all">All providers</option>
              {providers.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select
              aria-label="Filter processing model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="all">All models</option>
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          {tab === "overview" ? (
            <>
              <div className="ct-summary-grid">
                <div className="ct-summary-card">
                  <span>Recorded processing cost</span>
                  <strong>
                    {reportedMoney.length
                      ? reportedMoney
                          .map((m) =>
                            formatMoneyMicros(m.reportedMicros, m.currency),
                          )
                          .join(" + ")
                      : records.length && summary.localCount === records.length
                        ? "Local work"
                        : "Not recorded"}
                  </strong>
                  <small>
                    {reportedMoney.length
                      ? "Reported totals by currency. Estimates are shown separately below."
                      : records.length && summary.localCount === records.length
                        ? "No external provider charge is recorded."
                        : "No historical cost has been assumed."}
                  </small>
                </div>
                <div className="ct-summary-card">
                  <span>Processing usage</span>
                  <strong>
                    {usedCredits.length
                      ? usedCredits
                          .map((c) => `${c.used} ${c.unit}`)
                          .join(" + ")
                      : "Not recorded"}
                  </strong>
                  <small>
                    Provider credits and money are separate measures.
                  </small>
                </div>
                <div className="ct-summary-card">
                  <span>Recorded processing time</span>
                  <strong>
                    {records.length &&
                    records.some((r) => r.timing.processingMs !== undefined)
                      ? formatDuration(summary.workMs)
                      : "Not recorded"}
                  </strong>
                  <small>Sum of recorded work, not time spent editing.</small>
                </div>
                <div className="ct-summary-card">
                  <span>Activity</span>
                  <strong>{records.length}</strong>
                  <small>
                    {records.filter((r) => r.status === "succeeded").length}{" "}
                    completed ·{" "}
                    {records.filter((r) => r.status === "failed").length} failed
                  </small>
                </div>
              </div>
              {summary.money.length > 0 && (
                <section className="ct-rollup">
                  <h3>Money recorded by currency</h3>
                  {summary.money.map((m) => (
                    <div className="ct-rollup-row" key={m.currency}>
                      <strong>{m.currency}</strong>
                      <span>
                        {hasMoneyBasis(m.currency, "estimated")
                          ? formatMoneyMicros(m.estimatedMicros, m.currency)
                          : "Not recorded"}{" "}
                        estimated
                      </span>
                      <span>
                        {hasMoneyBasis(m.currency, "reported")
                          ? formatMoneyMicros(m.reportedMicros, m.currency)
                          : "Not recorded"}{" "}
                        reported / reconciled
                      </span>
                    </div>
                  ))}
                </section>
              )}
              {summary.credits.length > 0 && (
                <section className="ct-rollup">
                  <h3>Credits by unit</h3>
                  {summary.credits.map((c) => (
                    <div className="ct-rollup-row" key={c.unit}>
                      <strong>{c.unit}</strong>
                      <span>
                        {records.some((r) => r.estimate?.creditUnit === c.unit)
                          ? `${c.estimated} estimated`
                          : "Estimate not recorded"}{" "}
                        ·{" "}
                        {records.some(
                          (r) =>
                            r.usage.creditUnit === c.unit &&
                            r.usage.credits !== undefined,
                        )
                          ? `${c.used} used`
                          : "Usage not recorded"}
                      </span>
                      <span>
                        {records.some(
                          (r) =>
                            r.usage.creditUnit === c.unit &&
                            r.cost.reservedCredits !== undefined,
                        )
                          ? `${c.reserved} reserved`
                          : "Reservation not recorded"}{" "}
                        ·{" "}
                        {records.some(
                          (r) =>
                            r.usage.creditUnit === c.unit &&
                            r.cost.refundedCredits !== undefined,
                        )
                          ? `${c.refunded} refunded`
                          : "Refund not recorded"}
                      </span>
                    </div>
                  ))}
                </section>
              )}
              <div className="ct-truth-note">
                <PauseCircle size={20} />
                <div>
                  <strong>Detailed model generation is paused.</strong>
                  <p>
                    Included room and furniture assets have no recorded
                    generation history here. An empty history means “not
                    recorded”, rather than a claim that past processing cost
                    nothing.
                  </p>
                  {summary.unknownCostCount > 0 && (
                    <p>
                      {summary.unknownCostCount} operation
                      {summary.unknownCostCount === 1 ? " has" : "s have"} no
                      recorded monetary cost.
                    </p>
                  )}
                  {summary.unknownTimingCount > 0 && (
                    <p>
                      {summary.unknownTimingCount} operation
                      {summary.unknownTimingCount === 1
                        ? " has"
                        : "s have"}{" "}
                      incomplete timing information.
                    </p>
                  )}
                </div>
              </div>
              {records.length > 0 ? (
                <section className="ct-recent">
                  <div className="ct-section-heading">
                    <h3>Recent activity</h3>
                    <button
                      className="pw-text-button"
                      onClick={() => setTab("activity")}
                    >
                      View all activity <ChevronDown size={13} />
                    </button>
                  </div>
                  {recordList(records.slice(0, 4))}
                </section>
              ) : (
                <div className="ct-empty">
                  <Clock3 size={31} strokeWidth={1} />
                  <h3>No processing recorded yet.</h3>
                  <p>
                    Product lookups, imported models and future generation
                    attempts will appear here as they happen.
                  </p>
                </div>
              )}
            </>
          ) : tab === "images" ? (
            <section className="ct-images">
              <div className="ct-section-heading">
                <div>
                  <h3>Photos and their processing</h3>
                  <p>See which operations used each image.</p>
                </div>
                <span className="pw-count">{images.length}</span>
              </div>
              {!images.length ? (
                <div className="ct-empty">
                  <Image size={31} strokeWidth={1} />
                  <h3>No product photos in this view.</h3>
                  <p>
                    Add a photo to a product to keep its reference and
                    processing history together.
                  </p>
                </div>
              ) : (
                images.map(({ product, image, records: imageRecords }) => (
                  <article
                    className="ct-image-group"
                    key={`${product.id}-${image.id}`}
                  >
                    <div className="ct-image-group-heading">
                      <div className="ct-image-thumb">
                        {isSafeProductImageUrl(image.url) ? (
                          <img
                            src={image.url}
                            alt={product.title || "Product reference"}
                          />
                        ) : (
                          <Image size={24} />
                        )}
                      </div>
                      <div>
                        <h4>{product.title || "Untitled product"}</h4>
                        <p>
                          {image.name || "Product photo"} ·{" "}
                          {image.source === "upload"
                            ? "Added by you"
                            : "From listing"}
                        </p>
                        <small>
                          {imageRecords.length
                            ? `${imageRecords.length} recorded operation${imageRecords.length === 1 ? "" : "s"}`
                            : "Reference only · no processing recorded"}
                        </small>
                      </div>
                    </div>
                    {recordList(imageRecords)}
                  </article>
                ))
              )}
            </section>
          ) : tab === "components" ? (
            <section>
              <div className="ct-section-heading">
                <div>
                  <h3>Furniture and components</h3>
                  <p>Work associated with each product or room component.</p>
                </div>
              </div>
              {!componentGroups.length ? (
                <div className="ct-empty">
                  <Layers3 size={31} strokeWidth={1} />
                  <h3>No component processing recorded.</h3>
                  <p>
                    Your existing furniture is available to edit. Future imports
                    and processing will be listed here.
                  </p>
                </div>
              ) : (
                componentGroups.map((group, index) => {
                  const product = products.find(
                    (p) =>
                      p.id === group.id ||
                      group.records.some((r) => r.productId === p.id),
                  );
                  return (
                    <section className="ct-component-group" key={group.id}>
                      <div className="ct-section-heading">
                        <h4>
                          {product?.title || `Room component ${index + 1}`}
                        </h4>
                        <span>
                          {group.records.length} operation
                          {group.records.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {recordList(group.records)}
                    </section>
                  );
                })
              )}
            </section>
          ) : (
            <section>
              <div className="ct-section-heading">
                <div>
                  <h3>Processing activity</h3>
                  <p>Every recorded attempt, including failures and retries.</p>
                </div>
                <span className="pw-count">{records.length}</span>
              </div>
              {records.length ? (
                recordList(records)
              ) : (
                <div className="ct-empty">
                  <Activity size={31} strokeWidth={1} />
                  <h3>No activity matches this view.</h3>
                  <p>
                    Change the filters, or check back after a product lookup or
                    model import.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
        <footer className="ct-footer">
          <Clock3 size={14} />
          <span>
            {storageNote || "Browser work is recorded on this device. Signed-in server operations also appear in your account. Processing costs and time only; historical costs are not reconstructed."}
          </span>
        </footer>
      </div>
    </div>
  );
}
