import type { Change } from '../../shared/protocol'
import { diffLines } from '../transcript'

/**
 * A condensed diff, as the reviewer sees it.
 *
 * The complete file is never sent and is deliberately not shown: an approval the reviewer
 * cannot actually read is decorative, and a whole-file body asks them to spot the
 * difference themselves. Two lines of context either side, matching the terminal, so an
 * approval means the same thing in both interfaces.
 */
export function Diff({ changes }: { changes: Change[] }): React.JSX.Element {
  return (
    <pre className="diff">
      {diffLines(changes).map((line, index) => (
        <div key={index} className={`line ${line.kind}`}>
          <span className="sign">{line.sign}</span>
          <span className="text">{line.text}</span>
        </div>
      ))}
    </pre>
  )
}
