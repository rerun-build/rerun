export const richTextClassName = [
    '[&_p]:leading-relaxed [&_p:not(:first-child)]:mt-3',
    '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground',
    '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground',
    '[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:ps-5',
    '[&_li]:mt-1 [&_li>p]:mt-0',
    '[&_blockquote]:mt-3 [&_blockquote]:border-s-2 [&_blockquote]:border-foreground/20 [&_blockquote]:ps-3 [&_blockquote]:text-foreground/60 [&_blockquote]:italic',
    '[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-foreground/40 [&_a:hover]:decoration-foreground',
    '[&_strong]:font-semibold [&_strong]:text-foreground',
    '[&_hr]:my-4 [&_hr]:border-t [&_hr]:border-foreground/15',
    '[&_code]:rounded [&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground',
    '[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-foreground/5 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[0.85em] [&_pre]:leading-relaxed',
    '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em]',
].join(' ')
