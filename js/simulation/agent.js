// agent.js
// Defines archetype templates and agent creation
// createAgent() is called by engine.js when guests spawn
// Does NOT handle movement or decisions - that is engine.js

const ARCHETYPES = {

    ride_activity_enthusiast: {
        id: "ride_activity_enthusiast",
        name: "Ride/Activity Enthusiast",
        fixed: {
            preferenceWeights: {
            attractions: 0.70,
            activities: 0.15,
            shopping: 0.15
        },
        reRideTendency: "high",
        reRideCooldownMinutes: 120,
        energyDrainRate: "medium",
        energyRecoveryRate: "medium",
        groupSize: { min: 1, max: 2 },
        canSplit: true,
        flavors: {
            ride: {
                attractions: 0.70,
                activities: 0.15,
                shopping: 0.15
            },
            activity: {
                attractions: 0.15,
                activities: 0.70,
                shopping: 0.15
            }
        },
    },
    baseStats: {
        energy: 100,
        satisfaction: 100,
        balkingMinutes: {
            preferred: 60,
            other: 30
        },
        stayHours: { min: 10, max: 11}
        }
    },

    season_pass_holder: {
        id: "season_pass_holder",
        name: "Season Pass Holder",
        fixed: {
            preferenceWeights: {
                attractions: 0.50,
                activities: 0.30,
                shopping: 0.20
            },
            reRideTendency: "low",
            reRideCooldownMinutes: null,
            energyDrainRate: "low",
            energyRecoveryRate: "high",
            groupSize: { min:1, max: 2 },
            canSplit: true
        },
        baseStats: {
            energy: 100,
            satisfaction: 100,
            balkingMinutes: {
                preferred: 20,
                other: 20
            },
            stayHours: { min: 5, max: 6}
        }
    },

    once_in_a_lifetime: {
        id: "once_in_a_lifetime",
        name: "Once in a Lifetime Family",
        fixed: {
            preferenceWeights: {
                attractions: 0.40,
                activities: 0.40,
                shopping: 0.20,
            },
            reRideTendency: "low",
            reRideCooldownMinutes: 480,
            energyDrainRate: "high",
            energyRecoveryRate: "slow",
            groupSize: {min: 3, max:5 },
            canSplit: true,
            splitMin: 2
        },
        baseStats: {
            energy: 100,
            satisfaction: 100,
            balkingMinutes: {
                preferred: 120,
                other: 90
            },
            stayHours: { min:10, max:12}
        }
    },

        friend_group: {
        id: "friend_group",
        name: "Friend Group",
        fixed: {
            preferenceWeights: {
                attractions: 0.20,
                activities: 0.40,
                shopping: 0.40
            },
            reRideTendency: "medium",
            reRideCooldownMinutes: 180,
            energyDrainRate: "medium",
            energyRecoveryRate: "medium",
            groupSize: { min: 2, max: 4 },
            canSplit: true,
            splitMin: 1
        },
        baseStats: {
            energy: 100,
            satisfaction: 100,
            balkingMinutes: {
                preferred: 60,
                other: 30
            },
            stayHours: { min: 7, max: 9 }
        }
    },

        newly_married: {
        id: "newly_married",
        name: "Newly Married Couple",
        fixed: {
            preferenceWeights: {
                attractions: 0.50,
                activities: 0.30,
                shopping: 0.20
            },
            reRideTendency: "medium",
            reRideCooldownMinutes: 240,
            energyDrainRate: "low",
            energyRecoveryRate: "medium",
            groupSize: { min: 2, max: 2 },
            canSplit: false
        },
        baseStats: {
            energy: 100,
            satisfaction: 100,
            balkingMinutes: {
                preferred: 60,
                other: 30
            },
            stayHours: { min: 9, max: 10 }
        }
    },

        vip_entitled: {
        id: "vip_entitled",
        name: "VIP/Entitled Guest",
        fixed: {
            preferenceWeights: {
                attractions: 0.60,
                activities: 0.20,
                shopping: 0.20
            },
            reRideTendency: "high",
            reRideCooldownMinutes: 60,
            energyDrainRate: "veryLow",
            energyRecoveryRate: "veryFast",
            groupSize: { min: 1, max: 3 },
            canSplit: true,
            lineSkip: true
        },
        baseStats: {
            energy: 100,
            satisfaction: 100,
            balkingMinutes: {
                preferred: 20,
                other: 10
            },
            stayHours: { min: 8, max: 9 }
        }
    },

        vlogger: {
        id: "vlogger",
        name: "Vlogger",
        fixed: {
            preferenceWeights: {
                attractions: 0.35,
                activities: 0.35,
                shopping: 0.30
            },
            reRideTendency: "veryLow",
            reRideCooldownMinutes: 480,
            energyDrainRate: "veryLow",
            energyRecoveryRate: "veryFast",
            groupSize: { min: 1, max: 1 },
            canSplit: false
        },
        baseStats: {
            energy: 100,
            satisfaction: 100,
            balkingMinutes: {
                preferred: 15,
                other: 15
            },
            stayHours: { min: 11, max: 12 }
        }
    }
}

function createAgent(archetypeId) {
    
    const template = ARCHETYPES[archetypeId];

    const isFirstVisit = Math.random() < 0.30;
    const isForeignVisitor = Math.random() < 0.15;

    const stayHours = template.baseStats.stayHours.min + Math.random() * (template.baseStats.stayHours.max - template.baseStats.stayHours.min);

    const agent = {
        id: crypto.randomUUID(),
        archetypeId: archetypeId,
        name: template.name,
        fixed: { ...template.fixed },
        modifiers: {
            isFirstVisit: isFirstVisit,
            isForeignVisitor: isForeignVisitor
        },
        dynamic: {
            energy: 100,
            satisfaction: 100,
            balkingMinutes: { ...template.baseStats.balkingMinutes },
            stayMinutesRemaining: stayHours * 60,
            currentLand: "crossroads",
            currentAttraction: null,
            targetAttraction: null,
            waitingMinutes: 0,
            cooldowns: {}
        }
    };

    if (isFirstVisit) {
        agent.dynamic.balkingMinutes.preferred *= 0.80;
        agent.dynamic.balkingMinutes.other *= 0.80;
    }

    if (isForeignVisitor) {
        agent.dynamic.balkingMinutes.preferred *=1.25;
        agent.dynamic.balkingMinutes.other *= 1.25;
        agent.fixed.preferenceWeights.activities += 0.10;
        agent.fixed.preferenceWeights.shopping += 0.15;
        agent.fixed.preferenceWeights.attractions -= 0.25;
    }

    if (archetypeId === "ride_activity_enthusiast") {
        const flavor = Math.random() < 0.50 ? "ride" : "activity";
        agent.fixed.flavor = flavor;
        agent.fixed.preferenceWeights = { ...template.fixed.flavors[flavor] };
    }
    return agent;
}

export { ARCHETYPES, createAgent };