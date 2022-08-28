import { CommuneManager } from './communeManager'
import { Hauler } from './creeps/roleManagers/commune/hauler'

const reactionCycleAmount = 5000

const MINERALS: MineralConstant[] = ['U', 'L', 'Z', 'K', 'O', 'H', 'X']
const DECOMPOSITIONS: {
    [key in MineralCompoundConstant]?: (MineralConstant | MineralCompoundConstant)[]
} = {
    G: ['ZK', 'UL'],

    ZK: ['Z', 'K'],
    UL: ['U', 'L'],
    OH: ['H', 'O'],
    LH: ['L', 'H'],
    LO: ['L', 'O'],
    GH: ['G', 'H'],
    GO: ['G', 'O'],
    KO: ['K', 'O'],
    UH: ['U', 'H'],
    ZH: ['Z', 'H'],
    ZO: ['Z', 'O'],

    LH2O: ['LH', 'OH'],
    LHO2: ['LO', 'OH'],
    GH2O: ['GH', 'OH'],
    GHO2: ['GO', 'OH'],
    KHO2: ['KO', 'OH'],
    UH2O: ['UH', 'OH'],
    ZH2O: ['ZH', 'OH'],
    ZHO2: ['ZO', 'OH'],

    XLH2O: ['X', 'LH2O'],
    XLHO2: ['X', 'LHO2'],
    XGH2O: ['X', 'GH2O'],
    XGHO2: ['X', 'GHO2'],
    XKHO2: ['X', 'KHO2'],
    XUH2O: ['X', 'UH2O'],
    XZH2O: ['X', 'ZH2O'],
    XZHO2: ['X', 'ZHO2'],
}

const allCompounds: (MineralConstant | MineralCompoundConstant)[] = [...Object.keys(DECOMPOSITIONS), ...MINERALS] as (
    | MineralConstant
    | MineralCompoundConstant
)[]

function decompose(compound: MineralConstant | MineralCompoundConstant): (MineralConstant | MineralCompoundConstant)[] {
    return DECOMPOSITIONS[compound as MineralCompoundConstant]
}

export class LabManager {
    targetCompounds: { [key in MineralConstant | MineralCompoundConstant]?: number } = {
        G: 10000,
        OH: 5000,
    }

    deficits: { [key in MineralConstant | MineralCompoundConstant]?: number } = {}

    commune: CommuneManager
    outputRsc: MineralConstant | MineralCompoundConstant
    input1Rsc: MineralConstant | MineralCompoundConstant
    input2Rsc: MineralConstant | MineralCompoundConstant
    isReverse: boolean
    targetAmount: number
    lab1Id: string
    lab2Id: string
    lastLayoutCheck: number

    constructor(commune: CommuneManager) {
        this.commune = commune
    }

    private labsInRange(thisLab: StructureLab, otherLab: StructureLab = null): number {
        return _.filter(
            this.commune.structures.lab,
            lab => lab != thisLab && lab != otherLab && lab.pos.getRangeTo(thisLab.pos) <= 2,
        ).length
    }

    // Checks to ensure all of the internal data is valid, populate it if it's not.
    private doLayoutCheck(): void {
        if (this.lastLayoutCheck + 1000 > Game.time) return

        if (!this.lab1Id || !this.lab2Id || !this.input1 || !this.input2) {
            this.lab1Id = null
            this.lab2Id = null

            if (this.commune.structures.lab.length >= 3) {
                //Sort the labs by the distance to the terminal, so that labs on the side of the hub are favored.
                let sorted = _.sortBy(this.commune.structures.lab, lab =>
                    lab.pos.getRangeTo(this.commune.room.terminal?.pos),
                )
                let bestLab = sorted[0]
                //Starting at 2 intentally, to skip the first two records, which will be the default best labs...
                //  then we see if there's a lab that's better.
                //I'm not 100% sure this logic is perfect, but it's decent, but I think there may be an error in here.
                for (let i = 2; i < sorted.length; i++) {
                    let thisLab = sorted[i]
                    if (this.labsInRange(thisLab) > this.labsInRange(bestLab)) bestLab = thisLab
                }
                this.lab1Id = bestLab.id
                let lab1 = bestLab

                bestLab = sorted[1]
                for (let i = 2; i < sorted.length; i++) {
                    let thisLab = sorted[i]
                    if (this.labsInRange(thisLab, lab1) > this.labsInRange(bestLab, lab1)) bestLab = thisLab
                }
                this.lab2Id = bestLab.id
                //Make sure that both the sending labs are valid.... technically this should check to see how many labs overlap both labs.
                if (this.labsInRange(bestLab) == 0 || this.labsInRange(lab1) == 0) {
                    this.lab1Id = null
                    this.lab2Id = null
                }
            }
        }

        this.lastLayoutCheck = Game.time
    }

    public get input1(): StructureLab {
        return _.find(this.commune.structures.lab, lab => lab.id == this.lab1Id)
    }

    public get input2(): StructureLab {
        return _.find(this.commune.structures.lab, lab => lab.id == this.lab2Id)
    }

    public get outputs(): StructureLab[] {
        return _.filter(this.commune.structures.lab, lab => lab.id != this.lab1Id && lab.id != this.lab2Id)
    }

    public get all(): StructureLab[] {
        return this.commune.structures.lab
    }

    private isProperlyLoaded(): boolean {
        if (
            (this.input1.mineralType == this.input1Rsc || this.input1.mineralType == null) &&
            (this.input2.mineralType == this.input2Rsc || this.input2.mineralType == null)
        )
            return true
        return false
    }

    run() {
        if (!this.commune.room.storage || !this.commune.room.terminal) return

        this.doLayoutCheck()
        if (this.lab1Id) {
            this.updateDeficits()
            this.setCurrentReaction()
            if (this.isProperlyLoaded) {
                this.react()
            }
        }
    }

    get reactionAmountRemaining() {
        if (this.isReverse) {
            return this.amount(this.outputRsc) - this.targetAmount
        } else {
            let minMaterial = _.min(_.map(decompose(this.outputRsc), comp => this.amount(comp)))
            return Math.min(minMaterial, this.targetAmount - this.amount(this.outputRsc))
        }
    }

    isValid(): boolean {
        return this.outputs.length > 0 && this.input1 != null && this.input2 != null
    }

    reactionPossible(): boolean {
        if (!this.isValid()) return false
        if (!this.outputRsc) return false

        if (!this.isReverse) {
            if (!this.input1.mineralType || !this.inputSatisfied(this.input1, this.input1Rsc)) return false
            if (!this.input2.mineralType || !this.inputSatisfied(this.input2, this.input2Rsc)) return false
        }

        return true
    }

    inputSatisfied(inputLab: StructureLab, inputRsc: MineralConstant | MineralCompoundConstant): boolean {
        if (!inputLab) return false
        return !inputLab.mineralType || inputLab.mineralType === inputRsc
    }

    inputFull(inputLab: StructureLab) {
        if (!inputLab) return false
        if (!inputLab.mineralType) return false
        return (
            inputLab.store.getFreeCapacity(inputLab.mineralType) === 0 &&
            inputLab.store.getUsedCapacity(inputLab.mineralType) >= this.reactionAmountRemaining
        )
    }

    react() {
        if (!this.isValid()) return false
        if (!this.reactionPossible()) return false

        for (let output of this.outputs) {
            if (this.isReverse) {
                if (output.mineralType == this.outputRsc && output.store[this.outputRsc] >= LAB_REACTION_AMOUNT)
                    output.reverseReaction(this.input1, this.input2) //Reverse is here so the outputs line up with the expected locations
            } else {
                output.runReaction(this.input1, this.input2)
            }
        }
        return true
    }

    chainDecompose(compound: MineralConstant | MineralCompoundConstant, amount: number) {
        this.deficits[compound] = amount + (this.deficits[compound] || 0)
        amount = Math.min(amount, this.deficits[compound])
        amount = Math.max(amount, 0)

        let decomps = decompose(compound)

        for (var c in decomps) {
            this.chainDecompose(decomps[c], amount)
        }
    }

    private updateDeficits() {
        //We don't need to update this super often, so save CPU, this is midly expensive.
        if (Game.time % 10 != 0) return

        this.deficits = {}
        for (let key of allCompounds) {
            this.deficits[key as MineralConstant | MineralCompoundConstant] = -this.amount(
                key as MineralConstant | MineralCompoundConstant,
            )
        }
        for (let compound in this.targetCompounds) {
            var amount = Math.max(0, 10000) // this.commune.roomai.trading.maxStorageAmount(compound))

            this.chainDecompose(compound as MineralConstant | MineralCompoundConstant, amount)
        }

        for (let key of Object.keys(this.deficits)) {
            if (this.deficits[key as MineralConstant | MineralCompoundConstant] < 0)
                this.deficits[key as MineralConstant | MineralCompoundConstant] = 0
        }
    }

    private setupReaction(outputRsc: MineralCompoundConstant, targetAmount: number, reverse: boolean) {
        this.outputRsc = outputRsc
        if (outputRsc == null) {
            this.input1Rsc = null
            this.input2Rsc = null
        } else {
            this.input1Rsc = DECOMPOSITIONS[outputRsc][0]
            this.input2Rsc = DECOMPOSITIONS[outputRsc][1]
        }
        this.isReverse = reverse
        this.targetAmount = targetAmount
    }

    snoozeUntil: number
    replanAt: number

    private setCurrentReaction() {
        if (this.snoozeUntil && this.snoozeUntil > Game.time) return
        if (!this.isCurrentReactionFinished() && this.replanAt > Game.time) return

        let nextReaction = this.findNextReaction()
        //was...   But I kept getting negative values in the targetAmount.  I think I jusut need to get to the cycleAmount instead.
        //  Even then, that doesn't seem quite right.  Maybe it's correct for intermediates, but not for the end products.
        //  The second argtument is what amount level will cause the reactor to stop.
        //this.setupReaction(nextReaction, reactionCycleAmount - this.amount(nextReaction));
        if (nextReaction) {
            this.setupReaction(
                nextReaction.type,
                this.amount(nextReaction.type) + Math.min(reactionCycleAmount, nextReaction.amount),
                false,
            )
        } else if (this.commune.room.storage.store['GO'] > 1000) {
            this.setupReaction('GO', 1000, true)
        } else if (this.commune.room.storage.store['LO'] > 500) {
            this.setupReaction('LO', 500, true)
        } else {
            this.setupReaction(null, 0, false)
            this.snoozeUntil = Game.time + 30
        }
        //ReplanAt prevents some reactions that could run for a super long time, like breaking down 10000's of a compound,
        this.replanAt = Game.time + 3000
    }

    private isCurrentReactionFinished(): boolean {
        let currentReaction = this.outputRsc
        if (!currentReaction) return true
        if (this.isReverse) {
            if (this.amount(currentReaction) <= this.targetAmount) return true
            return false
        } else {
            if (_.any(decompose(currentReaction), r => this.amount(r) < LAB_REACTION_AMOUNT)) return true
            return this.amount(currentReaction) >= this.targetAmount
        }
    }

    private chainFindNextReaction(
        target: MineralConstant | MineralCompoundConstant,
        targetAmount: number,
    ): { type: MineralCompoundConstant; amount: number } {
        let nextReaction = target
        let missing = _.filter(decompose(nextReaction), r => this.amount(r) < LAB_REACTION_AMOUNT)
        console.log(targetAmount + ':' + target + ' missing: ' + JSON.stringify(missing))
        if (missing.length === 0) return { type: target as MineralCompoundConstant, amount: targetAmount }

        // filter uncookable resources (e.g. H). Can't get those using reactions.
        missing = _.filter(decompose(nextReaction), r => this.amount(r) < targetAmount)
        missing = _.filter(missing, r => decompose(r))
        for (let target of missing) {
            var result = this.chainFindNextReaction(target, targetAmount - this.amount(target))
            if (result) return result
        }
        return null
    }

    private findNextReaction(): { type: MineralCompoundConstant; amount: number } {
        let targets = _.sortBy(
            _.filter(
                Object.keys(this.targetCompounds),
                v => this.deficits[v as MineralConstant | MineralCompoundConstant] > 0,
            ),
            v => -this.deficits[v as MineralConstant | MineralCompoundConstant],
        )
        for (let target of targets) {
            var result = this.chainFindNextReaction(
                target as MineralConstant | MineralCompoundConstant,
                this.deficits[target as MineralConstant | MineralCompoundConstant],
            )
            if (result) return result
        }
        return null
    }

    private setupInputLab(
        creep: Hauler,
        inputLab: StructureLab,
        inputRsc: MineralConstant | MineralCompoundConstant,
    ): boolean {
        if (inputLab.mineralType == inputRsc || inputLab.mineralType == null) {
            let source =
                this.commune.room?.storage.store[inputRsc] > this.commune.room?.terminal.store[inputRsc]
                    ? this.commune.room.storage
                    : this.commune.room.terminal

            //This logic isn't quite correct, but it works, but I need to debug this at some point.
            //  If the creep starts with any of the desired resources, send the resources to it to free up the creep.
            //  Only if we have a creepful, should we withdraw from the source container.  This works, but isn't the minimum code to do it.
            let amount = Math.min(
                creep.store.getFreeCapacity(),
                source.store[inputRsc],
                inputLab.store.getFreeCapacity(inputRsc),
            )
            amount = Math.max(amount, 0)
            //Do the transfer if there's a bunch of free space in the lab, not necessiarly if there's a bunch in storage, that way
            //  We react all the resources laying around.
            if (inputLab.store.getFreeCapacity(inputRsc) >= creep.store.getCapacity()) {
                creep.createReservation('withdraw', source.id, amount, inputRsc)
                creep.createReservation('transfer', inputLab.id, amount, inputRsc)
            }
        } else {
            let amount = Math.min(creep.store.getFreeCapacity(), inputLab.store[inputLab.mineralType])
            creep.createReservation('withdraw', inputLab.id, amount, inputLab.mineralType)
            creep.createReservation(
                'transfer',
                this.commune.room.storage?.id,
                amount + creep.store[inputLab.mineralType],
                inputLab.mineralType,
            )
        }

        if (creep.memory.reservations?.length > 0) return true
        return false
    }

    private setupOutputLab(creep: Hauler, outputLab: StructureLab): boolean {
        if (
            (outputLab.mineralType != null && outputLab.mineralType != this.outputRsc) ||
            outputLab.usedStore(this.outputRsc) >= creep.store.getFreeCapacity()
        ) {
            let amount = Math.min(creep.freeStore(), outputLab.store[outputLab.mineralType])

            if (amount != 0) creep.createReservation('withdraw', outputLab.id, amount, outputLab.mineralType)
            if (amount + creep.usedStore(outputLab.mineralType) != 0)
                creep.createReservation(
                    'transfer',
                    this.commune.room.storage?.id,
                    amount + creep.store[outputLab.mineralType],
                    outputLab.mineralType,
                )
        }

        if (creep.memory.reservations?.length > 0) return true
        return false
    }

    private amount(resource: MineralConstant | MineralCompoundConstant): number {
        if (!resource) return 0
        let storageAmount = this.commune.room.storage.store[resource] || 0
        let terminalAmount = (this.commune.room.terminal && this.commune.room.terminal.store[resource]) || 0
        let labAmount = _.sum(
            _.filter(this.all, l => l.mineralType == resource),
            l => l.mineralAmount,
        )

        //Sum of haulers as well.
        let haulerAmount = _.sum(this.commune.room.myCreeps.hauler, crName => Game.creeps[crName]?.store[resource] || 0)

        return storageAmount + terminalAmount + labAmount + haulerAmount
    }

    generateHaulingReservation(creep: Hauler) {
        if (!this.lab1Id || !this.lab2Id) return

        //Priortize the worstly loaded lab.
        if (this.input2.store[this.input2Rsc] > this.input1.store[this.input1Rsc]) {
            if (this.setupInputLab(creep, this.input1, this.input1Rsc)) return
            if (this.setupInputLab(creep, this.input2, this.input2Rsc)) return
        } else {
            if (this.setupInputLab(creep, this.input2, this.input2Rsc)) return
            if (this.setupInputLab(creep, this.input1, this.input1Rsc)) return
        }
        for (const output of this.outputs) if (this.setupOutputLab(creep, output)) return
    }
}
