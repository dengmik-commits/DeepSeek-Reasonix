import { Box, Static, Text } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CardRenderer } from "../cards/CardRenderer.js";
import { useRenderTrace } from "../render-trace.js";
import type { Card } from "../state/cards.js";
import { useAgentState } from "../state/provider.js";
import { VerboseContext } from "../state/verbose-context.js";
import { FG } from "../theme/tokens.js";

interface StaticCardStreamProps {
  suppressLive?: boolean;
}

/** First chunk committed synchronously on mount — sized for ~1 frame of paint cost. */
const INITIAL_BATCH = 30;
/** Each subsequent batch released after a yield to the event loop. */
const PROGRESSIVE_BATCH = 30;
/**
 * Max settled cards rendered through `<Static>`. Beyond this window the DOM
 * grows unbounded, slowing Ink's reconciliation on every keystroke-triggered
 * re-render. Matches card-elision.ts RECENT_CARDS_WINDOW so recently-elided
 * cards are still visible.
 */
const MAX_STATIC_CARDS = 200;

function StaticCardStreamInner({
  suppressLive = false,
}: StaticCardStreamProps): React.ReactElement {
  useRenderTrace("StaticCardStream");
  const cards = useAgentState((s) => s.cards);
  const visibleCards = useProgressiveBacklog(cards);
  const { staticItems, dynamicItems, hasUnsettledDynamic } = useMemo(
    () => partition(visibleCards),
    [visibleCards],
  );
  const visibleDynamic =
    suppressLive && hasUnsettledDynamic && dynamicItems.length > 0
      ? dynamicItems.slice(0, -1)
      : dynamicItems;
  return (
    <>
      <Static items={staticItems}>
        {(card) => (
          <Box key={card.id} flexDirection="column" flexShrink={0}>
            {(card as any).kind === "__collapsed__" ? (
              <CollapsedMarker />
            ) : (
              <StaticCardRenderer card={card} />
            )}
          </Box>
        )}
      </Static>
      <Box flexDirection="column" flexShrink={0}>
        {visibleDynamic.map((card) => (
          <Box key={card.id} flexDirection="column" flexShrink={0}>
            <CardRenderer card={card} />
          </Box>
        ))}
      </Box>
    </>
  );
}

function StaticCardRenderer({ card }: { card: Card }): React.ReactElement {
  const verbose = React.useContext(VerboseContext);
  const frozenVerbose = useRef(verbose).current;
  return (
    <VerboseContext.Provider value={frozenVerbose}>
      <CardRenderer card={card} />
    </VerboseContext.Provider>
  );
}

/** Snapshot the initial backlog on first non-empty render; drain it in batches via
 *  setImmediate so first paint shows ~INITIAL_BATCH cards immediately and the
 *  event loop stays responsive for input. New cards added after drain bypass
 *  the gate. New cards added DURING drain are held back until the backlog
 *  catches up — keeps Static's append-only contract intact so chronological
 *  order is preserved. Gates the FULL cards array (not just the static partition)
 *  so an old unsettled live tail also drips while fresh cards bypass the gate. */
function useProgressiveBacklog(cards: readonly Card[]): Card[] {
  const backlogRef = useRef<number | null>(null);
  if (backlogRef.current === null && cards.length > 0) {
    backlogRef.current = cards.length;
  }
  const backlog = backlogRef.current ?? 0;
  const [released, setReleased] = useState(() => Math.min(INITIAL_BATCH, backlog));

  // Catch the case where we mounted empty and the backlog snapshot happens on a
  // later render — re-seed `released` so it tracks the freshly-snapshotted total.
  if (backlog > 0 && released === 0) {
    setReleased(Math.min(INITIAL_BATCH, backlog));
  }

  const draining = released < backlog;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `released` IS the cursor — each batch's state update must re-fire the effect to schedule the next batch. Removing it from the deps would deliver only one batch and stall the drain.
  useEffect(() => {
    if (!draining) return;
    const handle = setImmediate(() => {
      setReleased((r) => Math.min(backlog, r + PROGRESSIVE_BATCH));
    });
    return () => clearImmediate(handle);
  }, [draining, released, backlog]);

  if (!draining) return cards.slice();
  // Drop the held-back middle. Always include cards added AFTER the snapshot
  // (indices >= backlog) so new live activity isn't blocked by an old backlog.
  return cards.slice(0, released).concat(cards.slice(backlog));
}

/** Compact single-line summary for settled cards older than MAX_STATIC_CARDS.
 *  Uses a static string (no dynamic count) because Ink's `<Static>` never
 *  re-renders an item with the same key — a dynamic counter would freeze
 *  at its first value. */
function CollapsedMarker(): React.ReactElement {
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Text color={FG.faint}>{"╎ earlier cards collapsed"}</Text>
      </Box>
    </Box>
  );
}

export const StaticCardStream = React.memo(StaticCardStreamInner);
StaticCardStream.displayName = "StaticCardStream";

function partition(cards: readonly Card[]): {
  staticItems: Card[];
  dynamicItems: Card[];
  hasUnsettledDynamic: boolean;
} {
  // Settled cards are immutable terminal scrollback; verbose toggles only affect live/future cards.
  const firstDynamic = cards.findIndex((c) => !isFullySettled(c));
  let staticItems: Card[];
  let dynamicItems: Card[];
  let hasUnsettledDynamic: boolean;
  if (firstDynamic === -1) {
    staticItems = [...cards];
    dynamicItems = [];
    hasUnsettledDynamic = false;
  } else {
    dynamicItems = cards.slice(firstDynamic);
    staticItems = cards.slice(0, firstDynamic);
    hasUnsettledDynamic = dynamicItems.some((c) => !isFullySettled(c));
  }
  // Virtualize: cap settled cards to MAX_STATIC_CARDS so DOM doesn't grow unbounded.
  // Older cards beyond the window are replaced with a compact collapsed marker.
  if (staticItems.length > MAX_STATIC_CARDS) {
    const count = staticItems.length - MAX_STATIC_CARDS;
    staticItems = [
      { kind: "__collapsed__" as const, id: "__collapsed__" } as unknown as Card,
      ...staticItems.slice(count),
    ];
  }
  return { staticItems, dynamicItems, hasUnsettledDynamic };
}

function isFullySettled(card: Card): boolean {
  switch (card.kind) {
    case "streaming":
    case "tool":
      return card.done || !!card.aborted;
    case "reasoning":
      return !card.streaming || !!card.aborted;
    case "task":
    case "subagent":
      return card.status !== "running";
    case "plan":
      return card.steps.every((s) => s.status === "done" || s.status === "skipped");
    default:
      return true;
  }
}
