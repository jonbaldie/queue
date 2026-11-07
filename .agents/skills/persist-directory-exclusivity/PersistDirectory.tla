-------------------------- MODULE PersistDirectory --------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANT Servers

ASSUME Servers # {}

NoOwner == "no-owner"
ProcessStates == {"new", "serving", "refused", "stopped"}

VARIABLES processState, lockOwner, diskPending, localPending, deliveries

vars == <<processState, lockOwner, diskPending, localPending, deliveries>>

Init ==
    /\ processState = [s \in Servers |-> "new"]
    /\ lockOwner = NoOwner
    /\ diskPending = TRUE
    /\ localPending = [s \in Servers |-> FALSE]
    /\ deliveries = <<>>

StartServer(s) ==
    /\ processState[s] = "new"
    /\ lockOwner = NoOwner
    /\ processState' = [processState EXCEPT ![s] = "serving"]
    /\ lockOwner' = s
    /\ localPending' = [localPending EXCEPT ![s] = diskPending]
    /\ UNCHANGED <<diskPending, deliveries>>

RefuseStart(s) ==
    /\ processState[s] = "new"
    /\ lockOwner # NoOwner
    /\ processState' = [processState EXCEPT ![s] = "refused"]
    /\ UNCHANGED <<lockOwner, diskPending, localPending, deliveries>>

RestartAfterRefusal(s) ==
    /\ processState[s] = "refused"
    /\ lockOwner = NoOwner
    /\ processState' = [processState EXCEPT ![s] = "new"]
    /\ UNCHANGED <<lockOwner, diskPending, localPending, deliveries>>

Dequeue(s) ==
    /\ processState[s] = "serving"
    /\ localPending[s]
    /\ processState' = processState
    /\ diskPending' = FALSE
    /\ localPending' = [localPending EXCEPT ![s] = FALSE]
    /\ deliveries' = Append(deliveries, s)
    /\ UNCHANGED lockOwner

StopServer(s) ==
    /\ processState[s] = "serving"
    /\ processState' = [processState EXCEPT ![s] = "stopped"]
    /\ lockOwner' = NoOwner
    /\ UNCHANGED <<diskPending, localPending, deliveries>>

Done ==
    /\ lockOwner = NoOwner
    /\ \A s \in Servers: processState[s] \in {"refused", "stopped"}
    /\ UNCHANGED vars

Next ==
    \/ \E s \in Servers: StartServer(s)
    \/ \E s \in Servers: RefuseStart(s)
    \/ \E s \in Servers: RestartAfterRefusal(s)
    \/ \E s \in Servers: Dequeue(s)
    \/ \E s \in Servers: StopServer(s)
    \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ processState \in [Servers -> ProcessStates]
    /\ lockOwner \in Servers \cup {NoOwner}
    /\ diskPending \in BOOLEAN
    /\ localPending \in [Servers -> BOOLEAN]
    /\ deliveries \in Seq(Servers)

ActiveServers == {s \in Servers: processState[s] = "serving"}

OneServerOwnsDirectoryAtATime == Cardinality(ActiveServers) <= 1

LockMatchesServingServer ==
    /\ (lockOwner = NoOwner => ActiveServers = {})
    /\ (lockOwner # NoOwner => ActiveServers = {lockOwner})

NoJobDeliveredTwice == Len(deliveries) <= 1

=============================================================================
