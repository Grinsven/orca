// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PR_COMMENT_PRESENTATION_VARIANT,
  getPRCommentPresentationClasses,
  resolvePRCommentPresentationVariant
} from './pr-comment-presentation'

describe('pr-comment-presentation', () => {
  it('returns card layout tokens for cards and focus variants', () => {
    const cards = getPRCommentPresentationClasses('cards')
    expect(cards.useCardLayout).toBe(true)
    expect(cards.commentBody).toContain('text-[13px]')
    expect(cards.commentBody).toContain('leading-relaxed')
    expect(cards.commentBody).toContain('text-foreground')
    expect(cards.group).toContain('bg-secondary')
    expect(cards.group).toContain('shadow-xs')
    expect(cards.avatar).toContain('border-border')
    expect(cards.avatar).toContain('bg-background')
    // Why: replies must read nested under the root (GitHub-style), not full-width siblings.
    expect(cards.repliesContainer).toContain('ml-3')
    expect(cards.repliesContainer).toContain('border-l-2')
    expect(cards.commentRowReply).toContain('pl-3')

    const focus = getPRCommentPresentationClasses('focus')
    expect(focus.useCardLayout).toBe(true)
    expect(focus.commentBody).toContain('text-[13px]')
    expect(focus.commentBody).toContain('leading-relaxed')
    expect(focus.commentBodyReply).toContain('text-[13px]')
    expect(focus.commentBodyReply).toContain('leading-relaxed')
    expect(focus.author).toContain('text-[13px]')
    expect(focus.list).toContain('gap-2')
    expect(focus.commentBody).toContain('px-4 py-2.5')
    expect(focus.commentBodyReply).toContain('px-4 py-2.5')
    expect(focus.commentHeader).toContain('px-3 py-2')
    expect(focus.commentHeaderReply).toContain('px-3 py-2')
    expect(focus.commentHeaderMeta).toContain('pl-7')
    expect(focus.commentHeaderMetaWithSelection).toContain('pl-[3.25rem]')
    expect(focus.repliesContainer).toContain('ml-3')
    expect(focus.repliesContainer).toContain('border-l-2')
  })

  it('restores block flow for span-rendered markdown paragraphs and headings', () => {
    const observations = (['cards', 'focus', 'flat'] as const).map((variant) => {
      const markdown = getPRCommentPresentationClasses(variant).commentBodyMarkdown
      return {
        usesParagraphTags: markdown.includes('[&_p]:'),
        blockParagraphs: markdown.includes('[&_.comment-md-p]:block'),
        paragraphSpacing: markdown.includes('[&_.comment-md-p+.comment-md-p]:mt-2'),
        blockSpacing: markdown.includes('[&>:where(:not(:first-child))]:mt-2'),
        detailsSpacing: markdown.includes('[&_details]:my-2'),
        blockHeadings: markdown.includes('[&_.comment-md-h]:block'),
        headingSpacing: markdown.includes('[&_.comment-md-h]:mt-4')
      }
    })
    expect(observations).toEqual(
      Array.from({ length: 3 }, () => ({
        usesParagraphTags: false,
        blockParagraphs: true,
        paragraphSpacing: true,
        blockSpacing: true,
        detailsSpacing: true,
        blockHeadings: true,
        headingSpacing: true
      }))
    )
  })

  it('lifts code, pre, and table off the 10px compact defaults', () => {
    const markdown = getPRCommentPresentationClasses('cards').commentBodyMarkdown
    expect(markdown).toContain('[&_code]:text-[0.92em]')
    expect(markdown).toContain('[&_pre]:text-xs')
    // Code inside a fence must track the fence, not shrink again.
    expect(markdown).toContain('[&_pre_code]:text-[1em]')
    expect(markdown).toContain('[&_table]:text-[12px]')
  })

  it('stops sub/sup small-print from compounding below the caption tier', () => {
    const markdown = getPRCommentPresentationClasses('cards').commentBodyMarkdown
    // The browser's 75% nests: 13px -> 9.75px -> 7.3px. Absolute sizes don't compound.
    expect(markdown).toContain('[&_sub]:text-[11px]')
    expect(markdown).toContain('[&_sup]:text-[11px]')
  })

  it('neutralizes the baseline sag only for sub/sup wrapping a badge image', () => {
    const markdown = getPRCommentPresentationClasses('cards').commentBodyMarkdown
    // <sub><sub><img></sub></sub> stacks two -0.25em shifts; text subscripts keep theirs.
    expect(markdown).toContain('[&_sub:has(img)]:bottom-0')
    expect(markdown).toContain('[&_sub:has(img)]:align-middle')
    expect(markdown).not.toContain('[&_sub]:bottom-0')
  })

  it('gives headings a perceptible step over the 13px body', () => {
    const markdown = getPRCommentPresentationClasses('cards').commentBodyMarkdown
    // 13px headings over a 12px body was a 1.08x ratio — invisible. Match the
    // document variant's scale instead.
    expect(markdown).toContain('[&_.comment-md-h1]:text-[18px]')
    expect(markdown).toContain('[&_.comment-md-h2]:text-[16px]')
    expect(markdown).toContain('[&_.comment-md-h3]:text-[15px]')
    expect(markdown).not.toContain('[&_.comment-md-h1]:text-[13px]')
  })

  it('promotes bold-then-linebreak labels but not mid-sentence emphasis', () => {
    const markdown = getPRCommentPresentationClasses('cards').commentBodyMarkdown
    const label = '[&_.comment-md-p>strong:first-child:has(+br)'
    expect(markdown).toContain(`${label}]:text-[15px]`)
    expect(markdown).toContain(`${label}]:block`)
    expect(markdown).toContain('[&_.comment-md-p:first-child>strong:first-child:has(+br)]:mt-0')
    // Blocking the label makes its own <br> a duplicate break.
    expect(markdown).toContain(`${label}+br]:hidden`)
  })

  it('preserves the legacy flat layout tokens', () => {
    const flat = getPRCommentPresentationClasses('flat')
    expect(flat.useCardLayout).toBe(false)
    expect(flat.commentBody).toContain('text-muted-foreground')
    expect(flat.commentBody).toContain('text-[11px]')
  })

  it('falls back to the default variant when localStorage is unset', () => {
    window.localStorage.removeItem('orca:pr-comment-presentation')
    expect(resolvePRCommentPresentationVariant()).toBe(DEFAULT_PR_COMMENT_PRESENTATION_VARIANT)
  })
})
