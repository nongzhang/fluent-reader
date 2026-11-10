import { contextBridge } from "electron"
import settingsBridge from "./bridges/settings"
import utilsBridge from "./bridges/utils"
import dbBridge from "./bridges/db"
import translateBridge from "./bridges/translate"

contextBridge.exposeInMainWorld("settings", settingsBridge)
contextBridge.exposeInMainWorld("utils", utilsBridge)
contextBridge.exposeInMainWorld("db", dbBridge)
contextBridge.exposeInMainWorld("translate", translateBridge)
