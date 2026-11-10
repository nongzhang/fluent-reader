import { useEffect } from "react"
import { RSSItem } from "../../../scripts/models/item"
import { useAppDispatch, useAppSelector } from "../../../scripts/reducer"
import {
    requestTranslation,
    resolveTranslationTarget,
    translationKey,
} from "../../../scripts/translate"

type TranslationField = "title" | "snippet"

export function useTranslatedText(
    item: RSSItem,
    field: TranslationField
): string {
    const dispatch = useAppDispatch()
    const locale = useAppSelector(state => state.app.locale)
    const setting = useAppSelector(state => state.app.translateTarget)
    const target = resolveTranslationTarget(setting, locale)
    // Cards only display the first 325 characters of the snippet.
    const text =
        field === "snippet"
            ? (item.snippet || "").substr(0, 325)
            : item.title || ""
    const key = target && text ? translationKey(target, item._id, field) : null
    const translated = useAppSelector(state =>
        key ? state.app.translations[key] : undefined
    )

    useEffect(() => {
        if (key) dispatch(requestTranslation(item._id, text, field))
    }, [key])

    return translated || text
}
