export type LanguageOption = {
    value: string
    text: string
}

// Display languages supported by the interface. Values are also valid Google
// Translate target language codes.
export const LANGUAGE_OPTIONS: LanguageOption[] = [
    { value: "de", text: "Deutsch" },
    { value: "en-US", text: "English" },
    { value: "es", text: "Español" },
    { value: "cs", text: "Čeština" },
    { value: "fr-FR", text: "Français" },
    { value: "it", text: "Italiano" },
    { value: "nl", text: "Nederlands" },
    { value: "pt-BR", text: "Português do Brasil" },
    { value: "pt-PT", text: "Português de Portugal" },
    { value: "sk-SK", text: "Slovenčina" },
    { value: "fi-FI", text: "Suomi" },
    { value: "sv", text: "Svenska" },
    { value: "tr", text: "Türkçe" },
    { value: "uk", text: "Українська" },
    { value: "ru", text: "Русский" },
    { value: "ko", text: "한글" },
    { value: "ja", text: "日本語" },
    { value: "zh-CN", text: "中文（简体）" },
    { value: "zh-TW", text: "中文（繁體）" },
]

export function getLanguageName(value: string): string {
    return (
        LANGUAGE_OPTIONS.find(option => option.value === value)?.text || value
    )
}
