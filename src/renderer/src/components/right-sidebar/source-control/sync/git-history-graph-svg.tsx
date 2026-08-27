import React from 'react'
import type { GitHistoryGraphColorId } from '../../../../../../shared/git-history'
import {
  getGitHistoryItemColor,
  getGitHistoryItemLaneIndex,
  getGitHistoryMergeParentLaneIndex,
  type GitHistoryItemViewModel
} from '../../../../../../shared/git-history-graph'

const SWIMLANE_HEIGHT = 24
const SWIMLANE_WIDTH = 11
const SWIMLANE_CURVE_RADIUS = 5
const SWIMLANE_NODE_Y = SWIMLANE_HEIGHT / 2
const CIRCLE_RADIUS = 3.5
const CIRCLE_STROKE_WIDTH = 1.5
// Keeps the widest node halo inside the drawing box so clipping never cuts a normal row.
const GRAPH_RIGHT_PADDING = CIRCLE_RADIUS + CIRCLE_STROKE_WIDTH + 2
const MAX_RENDERED_SWIMLANES = 8
const GRAPH_WIDTH = SWIMLANE_WIDTH * (MAX_RENDERED_SWIMLANES + 1) + GRAPH_RIGHT_PADDING

export function graphColor(color: GitHistoryGraphColorId): string {
  return `var(--${color})`
}

/**
 * Centre of a swimlane, with lanes past the drawn cap folded onto the last one.
 * Without the fold an all-branches graph puts the commit node outside the viewBox and the row
 * renders empty; overlapping lines in the last column at least keep every commit visible.
 */
function laneX(index: number): number {
  return SWIMLANE_WIDTH * (Math.min(index, MAX_RENDERED_SWIMLANES) + 1)
}

function GraphPath({
  d,
  color,
  strokeWidth = 1
}: {
  d: string
  color: GitHistoryGraphColorId
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <path
      d={d}
      fill="none"
      stroke={graphColor(color)}
      strokeLinecap="round"
      strokeWidth={strokeWidth}
    />
  )
}

export function GitHistoryGraphSvg({
  viewModel
}: {
  viewModel: GitHistoryItemViewModel
}): React.JSX.Element {
  const historyItem = viewModel.historyItem
  const inputSwimlanes = viewModel.inputSwimlanes
  const outputSwimlanes = viewModel.outputSwimlanes
  const inputIndex = inputSwimlanes.findIndex((node) => node.id === historyItem.id)
  const circleIndex = getGitHistoryItemLaneIndex(viewModel)
  const circleColor = getGitHistoryItemColor(viewModel)

  const paths: React.JSX.Element[] = []
  let outputSwimlaneIndex = 0

  for (let index = 0; index < inputSwimlanes.length; index += 1) {
    const color = inputSwimlanes[index]!.color
    if (inputSwimlanes[index]!.id === historyItem.id) {
      if (index !== circleIndex) {
        paths.push(
          <GraphPath
            key={`base-${inputSwimlanes[index]!.id}`}
            color={color}
            d={[
              `M ${laneX(index)} 0`,
              `A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${laneX(index) - SWIMLANE_WIDTH} ${SWIMLANE_NODE_Y}`,
              `H ${laneX(circleIndex)}`
            ].join(' ')}
          />
        )
      } else if (historyItem.parentIds.length > 0) {
        outputSwimlaneIndex += 1
      }
      continue
    }

    if (
      outputSwimlaneIndex < outputSwimlanes.length &&
      inputSwimlanes[index]!.id === outputSwimlanes[outputSwimlaneIndex]!.id
    ) {
      if (index === outputSwimlaneIndex) {
        paths.push(
          <GraphPath
            key={`vertical-${inputSwimlanes[index]!.id}`}
            color={color}
            d={`M ${laneX(index)} 0 V ${SWIMLANE_HEIGHT}`}
          />
        )
      } else {
        paths.push(
          <GraphPath
            key={`shift-${inputSwimlanes[index]!.id}-${outputSwimlanes[outputSwimlaneIndex]!.id}`}
            color={color}
            d={[
              `M ${laneX(index)} 0`,
              'V 6',
              `A ${SWIMLANE_CURVE_RADIUS} ${SWIMLANE_CURVE_RADIUS} 0 0 1 ${
                laneX(index) - SWIMLANE_CURVE_RADIUS
              } ${SWIMLANE_HEIGHT / 2}`,
              `H ${laneX(outputSwimlaneIndex) + SWIMLANE_CURVE_RADIUS}`,
              `A ${SWIMLANE_CURVE_RADIUS} ${SWIMLANE_CURVE_RADIUS} 0 0 0 ${laneX(
                outputSwimlaneIndex
              )} ${SWIMLANE_HEIGHT / 2 + SWIMLANE_CURVE_RADIUS}`,
              `V ${SWIMLANE_HEIGHT}`
            ].join(' ')}
          />
        )
      }
      outputSwimlaneIndex += 1
    }
  }

  for (let index = 1; index < historyItem.parentIds.length; index += 1) {
    const parentId = historyItem.parentIds[index]!
    const parentOutputIndex = getGitHistoryMergeParentLaneIndex(viewModel, parentId)
    if (parentOutputIndex === -1) {
      continue
    }
    paths.push(
      <GraphPath
        key={`merge-parent-${parentId}`}
        color={outputSwimlanes[parentOutputIndex]!.color}
        d={[
          `M ${laneX(parentOutputIndex) - SWIMLANE_WIDTH} ${SWIMLANE_HEIGHT / 2}`,
          `A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${laneX(parentOutputIndex)} ${SWIMLANE_HEIGHT}`,
          `M ${laneX(parentOutputIndex) - SWIMLANE_WIDTH} ${SWIMLANE_HEIGHT / 2}`,
          `H ${laneX(circleIndex)}`
        ].join(' ')}
      />
    )
  }

  if (inputIndex !== -1) {
    paths.push(
      <GraphPath
        key="into-node"
        color={inputSwimlanes[inputIndex]!.color}
        d={`M ${laneX(circleIndex)} 0 V ${SWIMLANE_HEIGHT / 2}`}
      />
    )
  }
  if (historyItem.parentIds.length > 0) {
    paths.push(
      <GraphPath
        key="out-of-node"
        color={circleColor}
        d={`M ${laneX(circleIndex)} ${SWIMLANE_HEIGHT / 2} V ${SWIMLANE_HEIGHT}`}
      />
    )
  }

  const cx = laneX(circleIndex)
  const cy = SWIMLANE_NODE_Y
  const laneCount = Math.max(inputSwimlanes.length, outputSwimlanes.length, 1)
  // Why: an all-branches graph can reach dozens of lanes; cap the drawn width so the
  // commit subject keeps its column instead of being squeezed out of the row. laneX folds
  // the lanes past the cap into the last column so nothing lands outside this box.
  const width = Math.min(SWIMLANE_WIDTH * (laneCount + 1) + GRAPH_RIGHT_PADDING, GRAPH_WIDTH)
  const isBoundaryNode =
    viewModel.kind === 'incoming-changes' || viewModel.kind === 'outgoing-changes'
  const isMergeNode = historyItem.parentIds.length > 1

  return (
    <svg
      aria-hidden="true"
      className="shrink-0 overflow-hidden"
      width={width}
      height={SWIMLANE_HEIGHT}
      viewBox={`0 0 ${width} ${SWIMLANE_HEIGHT}`}
    >
      {paths}
      {viewModel.kind === 'HEAD' && (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={CIRCLE_RADIUS + 3}
            fill={graphColor(circleColor)}
            stroke="var(--background)"
            strokeWidth={CIRCLE_STROKE_WIDTH}
          />
          <circle cx={cx} cy={cy} r={CIRCLE_STROKE_WIDTH} fill="var(--background)" />
        </>
      )}
      {isBoundaryNode && (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={CIRCLE_RADIUS + 3}
            fill={graphColor(circleColor)}
            stroke="var(--background)"
            strokeWidth={CIRCLE_STROKE_WIDTH}
          />
          <circle
            cx={cx}
            cy={cy}
            r={CIRCLE_RADIUS + 1}
            fill="var(--background)"
            stroke="var(--background)"
            strokeWidth={CIRCLE_STROKE_WIDTH + 1}
          />
          <circle
            cx={cx}
            cy={cy}
            r={CIRCLE_RADIUS + 1}
            fill="none"
            stroke={graphColor(circleColor)}
            strokeDasharray="4 2"
            strokeWidth={CIRCLE_STROKE_WIDTH - 1}
          />
        </>
      )}
      {!isBoundaryNode && viewModel.kind !== 'HEAD' && isMergeNode && (
        <>
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 1} fill={graphColor(circleColor)} />
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS - 1.5} fill="var(--background)" />
        </>
      )}
      {!isBoundaryNode && viewModel.kind !== 'HEAD' && !isMergeNode && (
        <circle cx={cx} cy={cy} r={CIRCLE_RADIUS} fill={graphColor(circleColor)} />
      )}
    </svg>
  )
}
