Add-Type -AssemblyName System.Speech
$bytes = [System.Convert]::FromBase64String('SXQgc2VlbXMgeW91ciBzZW50ZW5jZSBtaWdodCBiZSBpbmNvbXBsZXRlLiBDb3VsZCB5b3UgcGxlYXNlIHByb3ZpZGUgbW9yZSBjb250ZXh0IG9yIGNsYXJpZnkgd2hhdCB5b3UncmUgdHJ5aW5nIHRvIGFzayBvciBleHByZXNz')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
// Slightly slower, smoother rate for a calm and natural delivery.
$synth.Rate = -2
$synth.Volume = 95
$synth.Speak($text)
$synth.Dispose()