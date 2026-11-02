import { useState, type FormEvent, type ReactNode } from 'react'
import type { InteractiveRequest, Locale } from '../../../shared/types'
import { translate } from '../i18n'
import { Modal } from './Modal'

export function InteractiveDialog({
  request,
  locale,
  onClose,
  onSubmit
}: {
  request: InteractiveRequest
  locale: Locale
  onClose: () => void
  onSubmit: (answers: string[]) => void
}): ReactNode {
  const [answers, setAnswers] = useState<string[]>(() =>
    request.prompts.map(() => '')
  )

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    onSubmit(answers)
  }

  return (
    <Modal
      title={translate(locale, 'interactiveTitle')}
      subtitle={request.name ? request.name.slice(0, 120) : undefined}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>
            {translate(locale, 'interactiveCancel')}
          </button>
          <button className="button primary" type="submit" form="interactive-form">
            {translate(locale, 'interactiveSubmit')}
          </button>
        </>
      }
    >
      <form id="interactive-form" className="form" onSubmit={submit}>
        <p className="hint">{translate(locale, 'interactiveIntro')}</p>
        {request.instructions ? (
          <div className="notice">{request.instructions.slice(0, 500)}</div>
        ) : null}
        {request.prompts.map((prompt, index) => (
          <label className="field" key={`${index}-${prompt.prompt}`}>
            <span>{prompt.prompt.slice(0, 200)}</span>
            <input
              type={prompt.echo ? 'text' : 'password'}
              value={answers[index] ?? ''}
              onChange={(event) => {
                const next = answers.slice()
                next[index] = event.target.value
                setAnswers(next)
              }}
              autoFocus={index === 0}
              autoComplete="off"
            />
          </label>
        ))}
      </form>
    </Modal>
  )
}
