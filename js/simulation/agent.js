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
        canSplit: true
    },
    baseStats: {
        energy: 100,
        satisfaction: 100,
        balkingMinutes: {
            prefered: 60,
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
            reRideTendency: "low"
        }
    }
}