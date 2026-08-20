#Requires -Version 7.0
#Requires -Modules Pester

<#
  Regression coverage for #79: the "Run Pester tests" CI step calls the real design-state
  check (S12.5, tools/Test-DesignState.Tests.ps1) against this repository, which needs an
  authenticated gh exactly as the later "Check the design state against the tree" step
  already does - so it needs the same GH_TOKEN. Without it, an unauthenticated gh turns
  S12.5 into a could-not-evaluate (TrackerUnavailable) rather than a check of anything this
  step is meant to gate.
#>

# #79/kit-defect (design/90-decisions.md, 2026-08-20): this test assumes a "Check the design
# state against the tree" step already exists in .github/workflows/verify.yml, true in the kit's
# own repo but not yet added here - this repo has not adopted the design/state CI gate at all.
# Skipped rather than failed until that step exists.
$script:KitDesignStateGateWired = (Get-Content -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) '.github/workflows/verify.yml') -Raw) -match 'Check the design state against the tree'

Describe 'CI workflow: the Run Pester tests step is authenticated (#79)' {

    BeforeAll {
        $script:WorkflowPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.github/workflows/verify.yml'
        $script:Lines = Get-Content -LiteralPath $script:WorkflowPath
    }

    It 'the "Run Pester tests" step carries a GH_TOKEN env, the same as "Check the design state against the tree"' -Skip:(-not $script:KitDesignStateGateWired) {
        $stepIndex = ($script:Lines | Select-String -Pattern '- name: Run Pester tests').LineNumber
        $stepIndex | Should -Not -BeNullOrEmpty

        # The step body runs from its `- name:` line to the line before the next `- name:`
        # (or end of file), so this only inspects this one step's own env block.
        $nextStepIndex = ($script:Lines | Select-String -Pattern '^\s*- name:' |
            Where-Object { $_.LineNumber -gt $stepIndex } |
            Select-Object -First 1).LineNumber
        $endIndex = if ($nextStepIndex) { $nextStepIndex - 1 } else { $script:Lines.Count }
        $stepBody = $script:Lines[($stepIndex - 1)..($endIndex - 1)] -join "`n"

        $stepBody | Should -Match 'GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}'
    }
}
