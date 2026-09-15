Add-Type -AssemblyName System.Speech
$bytes = [System.Convert]::FromBase64String('V2VsY29tZSBiYWNrLCB0YWxraW5nLiBJIGFtIGxlYXJuaW5nIHlvdXIgdm9pY2UgYW5kIHN0eWxl')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
// Slightly slower, smoother rate for a calm and natural delivery.
$synth.Rate = -2
$synth.Volume = 95
$synth.Speak($text)
$synth.Dispose()