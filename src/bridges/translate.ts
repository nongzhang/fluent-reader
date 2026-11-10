import { ipcRenderer } from "electron"

const translateBridge = {
    translateTexts: (texts: string[], target: string): Promise<string[]> => {
        return ipcRenderer.invoke("translate-texts", texts, target)
    },
}

declare global {
    interface Window {
        translate: typeof translateBridge
    }
    var translate: typeof translateBridge
}

export default translateBridge
