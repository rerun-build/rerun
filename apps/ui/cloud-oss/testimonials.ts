export type Testimonial = { id: string; quote: string; author: string; role: string; company: string; companyLogo?: string; avatar?: string }

export const TESTIMONIALS: readonly Testimonial[] = []

export function testimonialCopy(testimonial: Testimonial, _locale: string): { quote: string; role: string } {
    return testimonial
}
