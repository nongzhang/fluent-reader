import * as React from "react"
import Highlights from "./highlights"
import { FeedFilter } from "../../scripts/models/feed"
import { RSSItem } from "../../scripts/models/item"
import { useTranslatedText } from "../utils/hooks/useTranslatedText"

type TranslatedHighlightsProps = {
    item: RSSItem
    field: "title" | "snippet"
    filter: FeedFilter
    title?: boolean
}

const TranslatedHighlights: React.FunctionComponent<TranslatedHighlightsProps> =
    props => {
        const text = useTranslatedText(props.item, props.field)
        return (
            <Highlights text={text} filter={props.filter} title={props.title} />
        )
    }

export default TranslatedHighlights
