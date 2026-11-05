# Test suite for C seating allocator (ds/seating.exe)
# Tests all allocation requirements and invariants

$exe = "$PSScriptRoot\seating.exe"
if (-not (Test-Path $exe)) {
    Write-Error "seating.exe not found at $exe"
    exit 1
}

$global:passed = 0
$global:failed = 0

function Assert-Invariants($inputStr, $csvOutput, $expectedStudents, $roomConfigs) {
    $lines = ($csvOutput.Trim() -split "`r?`n")
    if ($lines.Length -lt 2) {
        throw "Output has no data rows"
    }
    if ($lines[0] -ne "roll,department,classroom,row,bench,seat") {
        throw "Invalid CSV header: $($lines[0])"
    }

    $data = $lines[1..($lines.Length - 1)]
    if ($data.Length -ne $expectedStudents.Count) {
        throw "Total assigned count ($($data.Length)) does not match roster count ($($expectedStudents.Count))"
    }

    $seenRolls = @{}
    $seenSeats = @{}
    $benchCounts = @{}

    foreach ($row in $data) {
        $parts = $row -split ","
        if ($parts.Length -ne 6) {
            throw "Malformed CSV row: $row"
        }
        $roll = $parts[0]
        $dept = $parts[1]
        $room = $parts[2]
        $rowNum = [int]$parts[3]
        $benchNum = [int]$parts[4]
        $seatNum = [int]$parts[5]

        # Invariant 1: Each input student appears exactly once
        if ($seenRolls.ContainsKey($roll)) {
            throw "Student $roll appears more than once in output"
        }
        $seenRolls[$roll] = $true

        # Invariant 2: Student is not moved to unintended department
        if (-not $expectedStudents.ContainsKey($roll)) {
            throw "Student $roll was not in the input roster"
        }
        if ($expectedStudents[$roll] -ne $dept) {
            throw "Student $roll department changed from $($expectedStudents[$roll]) to $dept"
        }

        # Invariant 3: Seat is valid for the room
        $matchedRoom = $roomConfigs | Where-Object { $_.Number -eq $room }
        if (-not $matchedRoom) {
            throw "Student $roll seated in nonexistent room $room"
        }
        if ($rowNum -lt 1 -or $rowNum -gt $matchedRoom.Rows) {
            throw "Student $roll row $rowNum out of bounds (1-$($matchedRoom.Rows))"
        }
        if ($benchNum -lt 1 -or $benchNum -gt $matchedRoom.Benches) {
            throw "Student $roll bench $benchNum out of bounds (1-$($matchedRoom.Benches))"
        }
        if ($seatNum -lt 1 -or $seatNum -gt $matchedRoom.PerBench) {
            throw "Student $roll seat $seatNum out of bounds (1-$($matchedRoom.PerBench))"
        }

        # Invariant 4: Each allocated seat belongs to exactly one student
        $seatKey = "$($room)_$($rowNum)_$($benchNum)_$($seatNum)"
        if ($seenSeats.ContainsKey($seatKey)) {
            throw "Seat $seatKey assigned to multiple students ($roll and $($seenSeats[$seatKey]))"
        }
        $seenSeats[$seatKey] = $roll

        # Invariant 5: No bench exceeds its configured capacity
        $benchKey = "$($room)_$($rowNum)_$($benchNum)"
        if (-not $benchCounts.ContainsKey($benchKey)) {
            $benchCounts[$benchKey] = 0
        }
        $benchCounts[$benchKey]++
        if ($benchCounts[$benchKey] -gt $matchedRoom.PerBench) {
            throw "Bench $benchKey has $($benchCounts[$benchKey]) students, exceeding capacity of $($matchedRoom.PerBench)"
        }
    }
}

function Run-Test($name, $inputStr, $expectedSuccess, $expectedStudents = @{}, $roomConfigs = @(), $checkPolicyFn = $null) {
    Write-Host -NoNewline "Running: $name ... "

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo.FileName = $exe
    $proc.StartInfo.UseShellExecute = $false
    $proc.StartInfo.RedirectStandardInput = $true
    $proc.StartInfo.RedirectStandardOutput = $true
    $proc.StartInfo.RedirectStandardError = $true
    $proc.StartInfo.CreateNoWindow = $true

    $proc.Start() | Out-Null
    $proc.StandardInput.Write($inputStr)
    $proc.StandardInput.Close()

    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    $exitCode = $proc.ExitCode

    if ($expectedSuccess) {
        if ($exitCode -ne 0) {
            Write-Host "FAILED (Exit code $exitCode, expected 0. stderr: $stderr)" -ForegroundColor Red
            $global:failed++
            return
        }
        try {
            Assert-Invariants $inputStr $stdout $expectedStudents $roomConfigs
            if ($checkPolicyFn) {
                & $checkPolicyFn $stdout
            }
            Write-Host "PASSED" -ForegroundColor Green
            $global:passed++
        } catch {
            Write-Host "FAILED (Invariant violation: $_)" -ForegroundColor Red
            $global:failed++
        }
    } else {
        if ($exitCode -eq 0) {
            Write-Host "FAILED (Exit code 0, expected error)" -ForegroundColor Red
            $global:failed++
        } else {
            Write-Host "PASSED (Rejected cleanly: $($stderr.Trim()))" -ForegroundColor Green
            $global:passed++
        }
    }
}

# --- Test 1: One-seat benches ---
$input1 = "1`nR101 2 3 1`n6 0`n24001 CSE`n24002 CE`n24003 ECS`n24004 MECH`n24005 CSE`n24006 CE"
$students1 = @{"24001"="CSE";"24002"="CE";"24003"="ECS";"24004"="MECH";"24005"="CSE";"24006"="CE"}
$rooms1 = @([PSCustomObject]@{Number="R101";Rows=2;Benches=3;PerBench=1})
Run-Test "One-seat benches (exact capacity)" $input1 $true $students1 $rooms1

# --- Test 2: Two-seat benches ---
$input2 = "1`nR101 2 2 2`n8 0`n24001 CSE`n24002 CE`n24003 ECS`n24004 MECH`n24005 CSE`n24006 CE`n24007 ECS`n24008 MECH"
$students2 = @{"24001"="CSE";"24002"="CE";"24003"="ECS";"24004"="MECH";"24005"="CSE";"24006"="CE";"24007"="ECS";"24008"="MECH"}
$rooms2 = @([PSCustomObject]@{Number="R101";Rows=2;Benches=2;PerBench=2})
Run-Test "Two-seat benches (full capacity)" $input2 $true $students2 $rooms2

# --- Test 3: Multiple rooms with unequal capacities ---
$input3 = "2`nR101 1 2 2`nR102 2 1 1`n6 0`n24001 CSE`n24002 CE`n24003 ECS`n24004 MECH`n24005 CSE`n24006 CE"
$students3 = @{"24001"="CSE";"24002"="CE";"24003"="ECS";"24004"="MECH";"24005"="CSE";"24006"="CE"}
$rooms3 = @(
    [PSCustomObject]@{Number="R101";Rows=1;Benches=2;PerBench=2},
    [PSCustomObject]@{Number="R102";Rows=2;Benches=1;PerBench=1}
)
Run-Test "Multiple rooms with unequal capacities" $input3 $true $students3 $rooms3

# --- Test 4: Partial capacity (fewer students than seats) ---
$input4 = "1`nR101 3 3 2`n4 0`n24001 CSE`n24002 CE`n24003 ECS`n24004 MECH"
$students4 = @{"24001"="CSE";"24002"="CE";"24003"="ECS";"24004"="MECH"}
$rooms4 = @([PSCustomObject]@{Number="R101";Rows=3;Benches=3;PerBench=2})
Run-Test "Partial capacity (4 students in 18 seats)" $input4 $true $students4 $rooms4

# --- Test 5: Overflow capacity (5 students in 4 seats) -> must reject ---
$input5 = "1`nR101 1 2 2`n5 0`n24001 CSE`n24002 CE`n24003 ECS`n24004 MECH`n24005 CSE"
Run-Test "Overflow capacity rejection" $input5 $false

# --- Test 6: Empty input -> must reject ---
Run-Test "Empty input rejection" "" $false

# --- Test 7: Duplicate roll numbers -> must reject ---
$input7 = "1`nR101 1 2 2`n2 0`n24001 CSE`n24001 CE"
Run-Test "Duplicate roll rejection" $input7 $false

# --- Test 8: Duplicate classroom identifiers -> must reject ---
$input8 = "2`nR101 1 2 2`nR101 1 2 2`n2 0`n24001 CSE`n24002 CE"
Run-Test "Duplicate room identifier rejection" $input8 $false

# --- Test 9: Invalid department code -> must reject ---
$input9 = "1`nR101 1 2 2`n2 0`n24001 INVALID`n24002 CSE"
Run-Test "Invalid department code rejection" $input9 $false

# --- Test 10: Formula injection in roll number -> must reject ---
$input10 = "1`nR101 1 2 2`n2 0`n=24001 CSE`n24002 CE"
Run-Test "Formula injection in roll rejection" $input10 $false

# --- Test 11: Formula injection in room number -> must reject ---
$input11 = "1`n+R101 1 2 2`n2 0`n24001 CSE`n24002 CE"
Run-Test "Formula injection in room rejection" $input11 $false

# --- Test 12: Strict same department policy (satisfiable) ---
$input12 = "1`nR101 2 2 2`n4 1`n24001 CSE`n24002 CE`n24003 CSE`n24004 CE"
$students12 = @{"24001"="CSE";"24002"="CE";"24003"="CSE";"24004"="CE"}
$rooms12 = @([PSCustomObject]@{Number="R101";Rows=2;Benches=2;PerBench=2})
$checkSameDept = {
    param($csv)
    $benches = @{}
    $lines = ($csv.Trim() -split "`r?`n")[1..4]
    foreach ($line in $lines) {
        $p = $line -split ","
        $key = "$($p[2])_$($p[3])_$($p[4])"
        if (-not $benches.ContainsKey($key)) { $benches[$key] = @() }
        $benches[$key] += $p[1]
    }
    foreach ($k in $benches.Keys) {
        if ($benches[$k].Length -eq 2) {
            if ($benches[$k][0] -ne $benches[$k][1]) {
                throw "Bench $k mixed departments: $($benches[$k][0]) and $($benches[$k][1])"
            }
        }
    }
}
Run-Test "Strict same department (satisfiable)" $input12 $true $students12 $rooms12 $checkSameDept

# --- Test 13: Strict same department policy (unsatisfiable -> reject) ---
# 3 CSE, 1 CE in 2 benches (4 seats): impossible to seat without mixing
$input13 = "1`nR101 1 2 2`n4 1`n24001 CSE`n24002 CSE`n24003 CSE`n24004 CE"
Run-Test "Strict same department (unsatisfiable -> reject)" $input13 $false

# --- Test 14: Fallback same department policy (unsatisfiable -> fallback) ---
$input14 = "1`nR101 1 2 2`n4 3`n24001 CSE`n24002 CSE`n24003 CSE`n24004 CE"
$students14 = @{"24001"="CSE";"24002"="CSE";"24003"="CSE";"24004"="CE"}
$rooms14 = @([PSCustomObject]@{Number="R101";Rows=1;Benches=2;PerBench=2})
Run-Test "Fallback same department (policy 3)" $input14 $true $students14 $rooms14

# --- Test 15: Strict different departments policy (satisfiable) ---
$input15 = "1`nR101 2 2 2`n4 2`n24001 CSE`n24002 CE`n24003 CSE`n24004 CE"
$students15 = @{"24001"="CSE";"24002"="CE";"24003"="CSE";"24004"="CE"}
$rooms15 = @([PSCustomObject]@{Number="R101";Rows=2;Benches=2;PerBench=2})
$checkDiffDept = {
    param($csv)
    $benches = @{}
    $lines = ($csv.Trim() -split "`r?`n")[1..4]
    foreach ($line in $lines) {
        $p = $line -split ","
        $key = "$($p[2])_$($p[3])_$($p[4])"
        if (-not $benches.ContainsKey($key)) { $benches[$key] = @() }
        $benches[$key] += $p[1]
    }
    foreach ($k in $benches.Keys) {
        if ($benches[$k].Length -eq 2) {
            if ($benches[$k][0] -eq $benches[$k][1]) {
                throw "Bench $k has same department: $($benches[$k][0])"
            }
        }
    }
}
Run-Test "Strict different departments (satisfiable)" $input15 $true $students15 $rooms15 $checkDiffDept

# --- Test 16: Strict different departments policy (unsatisfiable -> reject) ---
# 3 CSE, 1 CE in 2 benches: by pigeonhole principle, at least one bench must pair 2 CSE
$input16 = "1`nR101 1 2 2`n4 2`n24001 CSE`n24002 CSE`n24003 CSE`n24004 CE"
Run-Test "Strict different departments (unsatisfiable -> reject)" $input16 $false

# --- Test 17: Fallback different departments policy (unsatisfiable -> fallback) ---
$input17 = "1`nR101 1 2 2`n4 4`n24001 CSE`n24002 CSE`n24003 CSE`n24004 CE"
$students17 = @{"24001"="CSE";"24002"="CSE";"24003"="CSE";"24004"="CE"}
$rooms17 = @([PSCustomObject]@{Number="R101";Rows=1;Benches=2;PerBench=2})
Run-Test "Fallback different departments (policy 4)" $input17 $true $students17 $rooms17

Write-Host ""
Write-Host "==============================="
Write-Host "Test Results: $global:passed Passed, $global:failed Failed"
if ($global:failed -gt 0) {
    exit 1
} else {
    exit 0
}
