'use client'

import { Field } from '@/components/ui/field'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { countryDialling, countryFlag, exampleNationalNumber, formatAsTyped, readTypedPhone, searchCountries } from '@/lib/phone/normalize'
import { cn } from '@/lib/utils'
import { useDialogPortalContainer } from '@rerun/ui/forms'
import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min'
import { useTranslations } from 'next-intl'
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

type PhoneNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
    label?: string
    labelTrailing?: ReactNode
    value: string
    onChange: (value: string) => void
    country: CountryCode
    onCountryChange: (country: CountryCode) => void
}

// One field for the whole number. The calling code on the left is text, and the search field of its
// own list: a click puts the caret in it and drops the countries underneath, digits or a name narrow
// them, a complete code settles by itself. It also follows what is typed in the number, so `+32…`
// or a pasted international number flips the country.
export const PhoneNumberInput = forwardRef<HTMLInputElement, PhoneNumberInputProps>(({ label, labelTrailing, value, onChange, country, onCountryChange, onKeyDown, disabled, ...props }, ref) => {
    const t = useTranslations('ui.phone')
    const listId = useId()
    // Null while the code is at rest, a string (possibly empty) while it is being searched.
    const [query, setQuery] = useState<string | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const boxRef = useRef<HTMLDivElement>(null)
    const codeRef = useRef<HTMLInputElement>(null)
    const numberRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    useImperativeHandle(ref, () => numberRef.current as HTMLInputElement)
    const [dialogProbeRef, portalContainer] = useDialogPortalContainer<HTMLSpanElement>()
    const searching = query !== null
    const currentCode = `+${getCountryCallingCode(country)}`
    const matches = useMemo(() => (query === null ? [] : searchCountries(query)), [query])

    useEffect(() => {
        listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }, [activeIndex])

    const pick = (picked: CountryCode) => {
        onCountryChange(picked)
        onChange(formatAsTyped(value.replace(/\D/g, ''), picked))
        setQuery(null)
        numberRef.current?.focus()
    }

    const search = (typed: string) => {
        const digits = typed.replace(/^\+/, '')
        const dialled = /^\d+$/.test(digits) ? countryDialling(digits, country) : null
        if (dialled) return pick(dialled)
        setQuery(typed)
        setActiveIndex(0)
    }

    const onCodeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActiveIndex(index => Math.max(0, Math.min(matches.length - 1, index + step)))
        }
        if (event.key === 'Enter') {
            // Prevented even with nothing to pick: Enter in the code must not submit the form.
            event.preventDefault()
            const active = matches[activeIndex]
            if (active) pick(active.code)
        }
        if (event.key === 'Escape' || (event.key === 'ArrowRight' && query === '')) {
            event.preventDefault()
            numberRef.current?.focus()
        }
    }

    const onNumberKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key === 'Enter') {
            // The code is a second text field, and a browser only submits on Enter by itself when a
            // form without a submit button holds a single one.
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
            return
        }
        const atStart = event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0
        if (!atStart || (event.key !== 'Backspace' && event.key !== 'ArrowLeft')) return
        event.preventDefault()
        codeRef.current?.focus()
    }

    const onType = (event: ChangeEvent<HTMLInputElement>) => {
        const typed = event.target.value
        const read = readTypedPhone(typed, country)
        if (read.country !== country) onCountryChange(read.country)
        if (read.phone !== typed) return onChange(read.phone)
        // Reformatting a deletion or an edit in the middle would fight the caret.
        const appending = typed.length > value.length && event.target.selectionStart === typed.length
        onChange(appending ? formatAsTyped(typed, country) : typed)
    }

    return (
        <Field label={label} labelTrailing={labelTrailing} htmlFor={props.id}>
            <Popover open={searching} onOpenChange={open => !open && setQuery(null)}>
                <PopoverAnchor asChild>
                    <div
                        ref={boxRef}
                        className="flex h-10 w-full items-center rounded-lg border border-input bg-background text-base transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary has-[input[aria-invalid=true]]:border-red-500 has-[input[aria-invalid=true]]:focus-within:ring-red-500 md:text-sm"
                    >
                        <label className="group flex h-full shrink-0 cursor-text items-center gap-1.5 pr-1.5 pl-3 has-disabled:cursor-not-allowed has-disabled:opacity-50">
                            <span ref={dialogProbeRef} key={country} aria-hidden className="animate-in text-base leading-none duration-200 fade-in-0 slide-in-from-bottom-1">
                                {countryFlag(country)}
                            </span>
                            {/* The hidden twin gives the code its width, the input lies over it. */}
                            <span className="relative inline-grid border-b border-dotted border-transparent transition-colors duration-200 group-hover:border-muted-foreground group-focus-within:border-primary">
                                <span aria-hidden className="invisible whitespace-pre tabular-nums">
                                    {query || currentCode}
                                </span>
                                <input
                                    ref={codeRef}
                                    role="combobox"
                                    aria-expanded={searching}
                                    aria-controls={listId}
                                    aria-label={t('code')}
                                    autoComplete="off"
                                    disabled={disabled}
                                    placeholder={currentCode}
                                    value={query ?? currentCode}
                                    onChange={event => search(event.target.value)}
                                    onFocus={() => {
                                        setQuery('')
                                        setActiveIndex(0)
                                    }}
                                    onBlur={() => setQuery(null)}
                                    onKeyDown={onCodeKeyDown}
                                    className="absolute inset-0 w-full bg-transparent tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                                />
                            </span>
                        </label>
                        <input
                            ref={numberRef}
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            placeholder={exampleNationalNumber(country)}
                            value={value}
                            onChange={onType}
                            onKeyDown={onNumberKeyDown}
                            disabled={disabled}
                            className="h-full min-w-0 flex-1 rounded-r-lg bg-transparent pr-3 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            {...props}
                        />
                    </div>
                </PopoverAnchor>
                <PopoverContent
                    container={portalContainer}
                    align="start"
                    className="w-(--radix-popover-trigger-width) p-1"
                    onOpenAutoFocus={event => event.preventDefault()}
                    onCloseAutoFocus={event => event.preventDefault()}
                    onInteractOutside={event => {
                        if (boxRef.current?.contains(event.target as Node)) event.preventDefault()
                    }}
                >
                    <div ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto">
                        {matches.map((candidate, index) => (
                            <div
                                key={candidate.code}
                                role="option"
                                aria-selected={index === activeIndex}
                                // Keeps the caret in the code: a blur would close the list before the click lands.
                                onMouseDown={event => event.preventDefault()}
                                onMouseMove={() => setActiveIndex(index)}
                                onClick={() => pick(candidate.code)}
                                className={cn('flex cursor-default items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm select-none', index === activeIndex && 'bg-muted')}
                            >
                                <span aria-hidden className="text-base leading-none">
                                    {countryFlag(candidate.code)}
                                </span>
                                <span className="flex-1 truncate">{candidate.name}</span>
                                <span className="text-muted-foreground tabular-nums">+{candidate.callingCode}</span>
                            </div>
                        ))}
                        {matches.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t('noCountry')}</p>}
                    </div>
                </PopoverContent>
            </Popover>
        </Field>
    )
})
PhoneNumberInput.displayName = 'PhoneNumberInput'
