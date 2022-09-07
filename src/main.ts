// Imports

// International

import './international/commands'
import './international/respawnHandler'
import { internationalManager } from './international/internationalManager'
import './international/config'
import './international/tickConfig'
import './international/creepOrganizer'
import './international/constructionSiteManager'
import './international/mapVisualsManager'
import './international/endTickManager'

// Room

import './room/remotesManager'
import { roomsManager } from 'room/roomsManager'
import './room/roomAdditions'

import './room/resourceAdditions'
import './room/roomObjectFunctions'

// Creep

import './room/creeps/creepAdditions'

// Other

import { memHack } from 'other/memHack'
import { customLog } from 'international/generalFunctions'
import { myColors } from 'international/constants'
import { configManager } from './international/config'
import { initProfiler } from 'other/profiler'

global.profiler = initProfiler()

export const loop = function () {
    try {
        memHack.run()

        internationalManager.tickReset()

        configManager.run()

        internationalManager.run()
        /*
    let cpu = Game.cpu.getUsed()

    console.log(new InternationalManager())

    customLog('CPU USED FOR TEST 1', Game.cpu.getUsed() - cpu, myColors.white, myColors.green)
 */
        roomsManager()

        internationalManager.mapVisualsManager()

        internationalManager.advancedGeneratePixel()
        internationalManager.advancedSellPixels()
    } catch (error) {
        customLog('ERROR', error, undefined, myColors.red)
    }
    internationalManager.endTickManager()
}
