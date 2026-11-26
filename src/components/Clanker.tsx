/** "Made by Clanker." credit: the CK monogram and the line in mono, kept small. */
export function Clanker({ withText = true }: { withText?: boolean }) {
  return (
    <span className="ck" aria-label="Made by Clanker">
      <svg viewBox="0 0 138 105" aria-hidden>
        <path fill="#0A4EF5" d="M23 0 L86 0 L86 34 L66 34 L66 20 L31 20 L20 31 L20 74 L31 85 L66 85 L66 71 L86 71 L86 105 L23 105 L0 82 L0 23 Z M113 0 L138 0 L110 52.5 L138 105 L113 105 L91 62 L67 62 L67 43 L91 43 Z" />
      </svg>
      {withText && <span>Made by Clanker.</span>}
    </span>
  )
}
