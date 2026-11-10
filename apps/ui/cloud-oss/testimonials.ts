// The shape the billing dialog reads from a quote, the same as Rerun Cloud's list.
export type Testimonial = { id: string; quote: string; author: string; role: string; company: string; companyLogo?: string; avatar?: string }

// No customer quote ships with the open source build: the billing dialog shows none.
export const TESTIMONIALS: readonly Testimonial[] = []

export function testimonialCopy(testimonial: Testimonial, _locale: string): { quote: string; role: string } {
    return testimonial
}
