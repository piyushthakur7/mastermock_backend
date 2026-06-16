$baseUrl = "https://mastermock-backend-5.onrender.com/api/v1"
$timestamp = Get-Date -UFormat "%s"

$adminEmail = "admin@example.com"
$adminPassword = "AdminPassword123!"

Write-Host "--- 1. Logging in as Admin ---"
$loginBody = @{
    email = $adminEmail
    password = $adminPassword
} | ConvertTo-Json

try {
    $adminLogin = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    $adminToken = $adminLogin.data.accessToken
    Write-Host "Admin Logged In."
} catch {
    Write-Host "Error logging in as admin:" $_.Exception.Response
    exit
}

$adminHeaders = @{ Authorization = "Bearer $adminToken" }

Write-Host "`n--- 2. Creating Mock Test as Admin ---"
# Creating a dummy category and course first might be needed? 
# The validator says course and category are optional!
$mockTestBody = @{
    title = "Test Mock Test $timestamp"
    description = "Created by test script"
    total_questions = 10
    passing_marks = 5
    total_marks = 10
    duration_minutes = 30
} | ConvertTo-Json

$mockTestId = $null
try {
    $mtResponse = Invoke-RestMethod -Uri "$baseUrl/mock-tests" -Method Post -Body $mockTestBody -ContentType "application/json" -Headers $adminHeaders
    $mockTestId = $mtResponse.data._id
    Write-Host "Success! Mock Test Created with ID: $mockTestId"
} catch {
    # If the response fails, we can read the response stream to see the error message.
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    Write-Host "Error creating mock test: $responseBody"
    exit
}

Write-Host "`n--- 3. Registering & Logging in Student ---"
$studentEmail = "student_$timestamp@example.com"
$studentPhone = $timestamp.Substring(0, 10)

$registerBody = @{
    full_name = "Student Test"
    email = $studentEmail
    password = "Password123!"
    phone_number = $studentPhone
} | ConvertTo-Json

try {
    $regResponse = Invoke-RestMethod -Uri "$baseUrl/auth/register" -Method Post -Body $registerBody -ContentType "application/json"
    Write-Host "Student Registered."
} catch {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    Write-Host "Error registering student: $responseBody"
}

$studentLoginBody = @{
    email = $studentEmail
    password = "Password123!"
} | ConvertTo-Json

try {
    $stuLogin = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $studentLoginBody -ContentType "application/json"
    $studentToken = $stuLogin.data.accessToken
    Write-Host "Student Logged In."
} catch {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    Write-Host "Error logging in student: $responseBody"
    exit
}

$studentHeaders = @{ Authorization = "Bearer $studentToken" }

Write-Host "`n--- 4. Fetching Mock Test as Student ---"
try {
    $getMtResponse = Invoke-RestMethod -Uri "$baseUrl/mock-tests/$mockTestId" -Method Get -Headers $studentHeaders
    Write-Host "Success! Fetched Mock Test as Student:"
    $getMtResponse.data | ConvertTo-Json -Depth 3
} catch {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $responseBody = $reader.ReadToEnd()
    Write-Host "Error fetching mock test as student: $responseBody"
}
