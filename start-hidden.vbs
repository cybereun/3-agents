Option Explicit
' 3 Agents hidden launcher: starts the server without a console window,
' opens the browser, and shows a popup only if the server fails to start.
Dim sh, fso, dir, i, port, ok, f

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' window style 0 = hidden, False = do not wait. If the app is already running,
' server.js just opens the browser and exits.
sh.Run "cmd /c node server.js --open --log", 0, False

ok = False
For i = 1 To 24
  WScript.Sleep 500
  If fso.FileExists(dir & "\.server.port") Then
    Set f = fso.OpenTextFile(dir & "\.server.port", 1)
    port = Trim(f.ReadAll())
    f.Close
    If IsNumeric(port) Then
      If Probe(CLng(port)) Then
        ok = True
        Exit For
      End If
    End If
  End If
Next

If Not ok Then
  MsgBox "3 Agents failed to start." & vbCrLf & vbCrLf & _
         "1) Is Node.js 22+ installed?  (run: node -v)" & vbCrLf & _
         "2) See the log:" & vbCrLf & dir & "\server.log", 48, "3 Agents"
End If

Function Probe(p)
  Dim http
  Probe = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1500
  http.open "GET", "http://127.0.0.1:" & p & "/api/config", False
  http.send
  If Err.Number = 0 Then
    If http.status = 200 Then Probe = True
  End If
  On Error GoTo 0
End Function
