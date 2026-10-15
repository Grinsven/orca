// @vitest-environment happy-dom
import { fireEvent, render, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { activateSourceControlRow } from './source-control-row-keyboard'

afterEach(cleanup)

it.each(['Enter', ' '])('opens the focused row with %s through its click handler', (key) => {
  const open = vi.fn()
  const view = render(
    <div data-testid="row" tabIndex={0} onKeyDown={activateSourceControlRow} onClick={open} />
  )
  fireEvent.keyDown(view.getByTestId('row'), { key })
  expect(open).toHaveBeenCalledOnce()
})

it('leaves nested action buttons and modified shortcuts alone', () => {
  const open = vi.fn()
  const view = render(
    <div data-testid="row" tabIndex={0} onKeyDown={activateSourceControlRow} onClick={open}>
      <button type="button">Stage</button>
    </div>
  )
  fireEvent.keyDown(view.getByRole('button'), { key: 'Enter' })
  fireEvent.keyDown(view.getByTestId('row'), { key: 'Enter', ctrlKey: true })
  fireEvent.keyDown(view.getByTestId('row'), { key: 'Enter', isComposing: true })
  expect(open).not.toHaveBeenCalled()
})
