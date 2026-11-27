# Prints the hosted runner's free memory, page file and heaviest processes: in the log
# in full, and in one notice annotation, which the run keeps with the step's record.
# A Python job stopped by its time limit once lost its whole log, and the tests once
# failed to start their first process with "the paging file is too small" (WinError 1455).
param([Parameter(Mandatory)][string]$Title)

$os = Get-CimInstance Win32_OperatingSystem
$pages = @(Get-CimInstance Win32_PageFileUsage)
$top = @(Get-Process | Sort-Object PagedMemorySize64 -Descending | Select-Object -First 12)

$os | Format-List FreePhysicalMemory, TotalVisibleMemorySize, FreeVirtualMemory, TotalVirtualMemorySize
$pages | Format-List Name, AllocatedBaseSize, CurrentUsage, PeakUsage
$top | Select-Object Name, Id, @{n = 'CommitMB'; e = { [int]($_.PagedMemorySize64 / 1MB) } }, @{n = 'WorkingSetMB'; e = { [int]($_.WorkingSet64 / 1MB) } } | Format-Table -AutoSize

# Win32_OperatingSystem counts kilobytes, Win32_PageFileUsage megabytes.
function Format-Megabytes([uint64]$Kilobytes) { [int]($Kilobytes / 1KB) }
$physical = "physical free $(Format-Megabytes $os.FreePhysicalMemory) of $(Format-Megabytes $os.TotalVisibleMemorySize) MB"
$virtual = "virtual free $(Format-Megabytes $os.FreeVirtualMemory) of $(Format-Megabytes $os.TotalVirtualMemorySize) MB"
$pageFile = ($pages | ForEach-Object { "$($_.Name) $($_.CurrentUsage) of $($_.AllocatedBaseSize) MB, peak $($_.PeakUsage)" }) -join '; '
$heaviest = ($top | Select-Object -First 3 | ForEach-Object { "$($_.Name) $([int]($_.PagedMemorySize64 / 1MB)) MB" }) -join ', '
Write-Output "::notice title=$Title::$physical; $virtual; page file $pageFile; heaviest $heaviest"
