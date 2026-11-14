import type Stripe from 'stripe'

export type TaxIdType = Stripe.CustomerCreateTaxIdParams.Type
export type TaxIdStatus = Stripe.TaxId.Verification.Status

const COUNTRY_TAX_ID_TYPES = [
    'ad_nrt', 'ae_trn', 'al_tin', 'am_tin', 'ao_tin', 'ar_cuit', 'au_abn', 'au_arn', 'aw_tin', 'az_tin',
    'ba_tin', 'bb_tin', 'bd_bin', 'bf_ifu', 'bg_uic', 'bh_vat', 'bj_ifu', 'bo_tin', 'br_cnpj', 'br_cpf',
    'bs_tin', 'by_tin', 'ca_bn', 'ca_gst_hst', 'ca_pst_bc', 'ca_pst_mb', 'ca_pst_sk', 'ca_qst', 'cd_nif',
    'ch_vat', 'ch_uid', 'cl_tin', 'cm_niu', 'cn_tin', 'co_nit', 'cr_tin', 'cv_nif', 'de_stn', 'do_rcn',
    'ec_ruc', 'eg_tin', 'es_cif', 'et_tin', 'fo_vat', 'gb_vat', 'ge_vat', 'gi_tin', 'gn_nif', 'hk_br',
    'hr_oib', 'hu_tin', 'id_npwp', 'il_vat', 'in_gst', 'is_vat', 'it_cf', 'jp_cn', 'jp_rn', 'jp_trn',
    'ke_pin', 'kg_tin', 'kh_tin', 'kr_brn', 'kz_bin', 'la_tin', 'li_uid', 'li_vat', 'lk_vat', 'ma_vat',
    'md_vat', 'me_pib', 'mk_vat', 'mr_nif', 'mx_rfc', 'my_frp', 'my_itn', 'my_sst', 'ng_tin', 'no_vat',
    'no_voec', 'np_pan', 'nz_gst', 'om_vat', 'pe_ruc', 'ph_tin', 'pl_nip', 'py_ruc', 'ro_tin', 'rs_pib',
    'ru_inn', 'ru_kpp', 'sa_vat', 'sg_gst', 'sg_uen', 'si_tin', 'sn_ninea', 'sr_fin', 'sv_nit', 'th_vat',
    'tj_tin', 'tr_tin', 'tw_vat', 'tz_vat', 'ua_vat', 'ug_tin', 'us_ein', 'uy_ruc', 'uz_tin', 'uz_vat',
    've_rif', 'vn_tin', 'za_vat', 'zm_tin', 'zw_tin',
] as const satisfies readonly TaxIdType[]

const EU_COUNTRIES = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'] as const

export function taxIdTypesFor(country: string | null | undefined): TaxIdType[] {
    if (!country) return []
    const code = country.toUpperCase()
    const national = COUNTRY_TAX_ID_TYPES.filter(type => type.slice(0, 2).toUpperCase() === code)
    return (EU_COUNTRIES as readonly string[]).includes(code) ? ['eu_vat', ...national] : national
}

export function taxIdTypeLabel(type: TaxIdType): string {
    return type.split('_').slice(1).join(' ').toUpperCase()
}

export function taxIdFieldLabel(type: TaxIdType | undefined): string {
    return type?.endsWith('_vat') ? 'VAT number' : 'Tax ID'
}

function vatPrefix(country: string): string {
    const code = country.toUpperCase()
    return code === 'GR' ? 'EL' : code
}

const EU_VAT_PREFIXES = new Set(EU_COUNTRIES.map(vatPrefix))

export function normalizeTaxIdValue(type: TaxIdType, value: string, country: string): string {
    if (type !== 'eu_vat') return value.trim()
    const compact = value.replace(/[\s.\-]/g, '').toUpperCase()
    return EU_VAT_PREFIXES.has(compact.slice(0, 2)) ? compact : `${vatPrefix(country)}${compact}`
}

export function taxIdPlaceholder(type: TaxIdType | undefined, country: string | null): string | undefined {
    if (type === 'eu_vat' && country) return `${vatPrefix(country)}123456789`
    return undefined
}

export const TAX_ID_STATUS_BADGE: Record<TaxIdStatus, { label: string; tone: 'green' | 'neutral' | 'orange' } | null> = {
    verified: { label: 'Verified', tone: 'green' },
    pending: { label: 'Checking', tone: 'neutral' },
    unverified: { label: 'Not verified', tone: 'orange' },
    unavailable: null,
}
