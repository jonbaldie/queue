-------------------------- MODULE RateLimitWindow --------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Times, InitialTime, Window, Limit, MaxCalls, ElapsedStep

ASSUME
    /\ Times # {}
    /\ InitialTime \in Times
    /\ Window \in Nat \ {0}
    /\ Limit \in Nat \ {0}
    /\ MaxCalls \in Nat \ {0}
    /\ ElapsedStep \in Nat \ {0}

VARIABLES now, elapsed, stored, admissions, admissionElapsed, calls, lastAllowed

vars == <<now, elapsed, stored, admissions, admissionElapsed, calls, lastAllowed>>

Init ==
    /\ now = InitialTime
    /\ elapsed = 0
    /\ stored = <<>>
    /\ admissions = <<>>
    /\ admissionElapsed = <<>>
    /\ calls = 0
    /\ lastAllowed = "not-started"

RECURSIVE FirstFreshSearch(_, _, _, _)
FirstFreshSearch(timestamps, cutoff, lo, hi) ==
    IF lo >= hi THEN lo
    ELSE
        LET mid == (lo + hi) \div 2
        IN IF timestamps[mid + 1] > cutoff
            THEN FirstFreshSearch(timestamps, cutoff, lo, mid)
            ELSE FirstFreshSearch(timestamps, cutoff, mid + 1, hi)

FirstFreshIndex(timestamps, cutoff) ==
    IF Len(timestamps) = 0 \/ timestamps[1] > cutoff THEN 0
    ELSE FirstFreshSearch(timestamps, cutoff, 0, Len(timestamps))

Request(at) ==
    /\ calls < MaxCalls
    /\ at \in Times
    /\ LET cutoff == at - Window
           firstFresh == FirstFreshIndex(stored, cutoff)
           freshCount == Len(stored) - firstFresh
           compacted ==
               IF freshCount = 0 THEN <<>>
               ELSE IF firstFresh > 0 /\ firstFresh * 2 >= Len(stored)
                   THEN SubSeq(stored, firstFresh + 1, Len(stored))
                   ELSE stored
           allowed == freshCount < Limit
       IN
           /\ now' = at
           /\ elapsed' = elapsed + ElapsedStep
           /\ stored' =
               (IF allowed THEN Append(compacted, at)
                ELSE IF freshCount = 0 THEN <<>> ELSE stored)
           /\ admissions' = IF allowed THEN Append(admissions, at) ELSE admissions
           /\ admissionElapsed' = IF allowed
               THEN Append(admissionElapsed, elapsed + ElapsedStep)
               ELSE admissionElapsed
           /\ calls' = calls + 1
           /\ lastAllowed' = IF allowed THEN "allowed" ELSE "denied"

Done ==
    /\ calls = MaxCalls
    /\ UNCHANGED vars

Next ==
    \/ \E at \in Times: Request(at)
    \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ now \in Times
    /\ elapsed \in Nat
    /\ stored \in Seq(Times)
    /\ admissions \in Seq(Times)
    /\ admissionElapsed \in Seq(Nat)
    /\ calls \in 0..MaxCalls
    /\ lastAllowed \in {"not-started", "allowed", "denied"}

CurrentWindowAdmissions ==
    {i \in 1..Len(admissionElapsed): admissionElapsed[i] > elapsed - Window}

NoMoreThanLimitInWindow == Cardinality(CurrentWindowAdmissions) <= Limit

=============================================================================
