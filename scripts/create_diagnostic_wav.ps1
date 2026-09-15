Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice.SelectVoice('Microsoft Zira Desktop')
} catch {
    # if the voice isn't available, continue with default
}
$out = "C:\Users\Darbe\.copilot\repos\copilot-worktrees\joyful-morning-blooms\airshift1-friendly-enigma\diagnostic-ella-sample.wav"
$voice.SetOutputToWaveFile($out)
$voice.Rate = 0
$voice.Volume = 100
$voice.Speak('Hello. This is a diagnostic test from Ella. If this sounds correct, the SAPI voice is working.')
$voice.Dispose()
Write-Output "WAV_WRITTEN:$out"
