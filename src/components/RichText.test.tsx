import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RichText } from './RichText'
describe('rich text', () => {
  it('renders UTF-8 byte facets after Japanese text without breaking the surrounding text', () => {
    render(
      <MemoryRouter>
        <RichText
          text="空 @you"
          facets={[
            {
              index: { byteStart: 4, byteEnd: 8 },
              features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:you' }],
            },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '@you' })).toHaveAttribute(
      'href',
      '/profile/did%3Aplc%3Ayou',
    )
    expect(screen.getByText('空')).toBeInTheDocument()
  })
  it('does not turn a malicious facet URL or HTML text into executable content', () => {
    const { container } = render(
      <MemoryRouter>
        <RichText
          text="<script>bad</script>"
          facets={[
            {
              index: { byteStart: 0, byteEnd: 19 },
              features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(1)' }],
            },
          ]}
        />
      </MemoryRouter>,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.textContent).toBe('<script>bad</script>')
  })
})
