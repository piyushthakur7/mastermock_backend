$baseUrl = "https://mastermock-backend-5.onrender.com/api/v1"
$timestamp = Get-Date -UFormat "%s"
$email = "testuser_$timestamp@example.com"
$phone = $timestamp.Substring(0, 10)

Write-Host "--- 1. Registering new user ---"
$registerBody = @{
    full_name = "Test User"
    email = $email
    password = "Password123!"
    phone_number = $phone
} | ConvertTo-Json

try {
    $registerResponse = Invoke-RestMethod -Uri "$baseUrl/auth/register" -Method Post -Body $registerBody -ContentType "application/json"
    Write-Host "Success! User Registered:"
    $registerResponse.data | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Error registering:" $_.Exception.Response
}

Write-Host "`n--- 2. Logging in ---"
$loginBody = @{
    email = $email
    password = "Password123!"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    Write-Host "Success! User Logged In."
    $accessToken = $loginResponse.data.accessToken
} catch {
    Write-Host "Error logging in:" $_.Exception.Response
}

Write-Host "`n--- 3. Fetching Enrolled Courses (Authenticated) ---"
if ($accessToken) {
    $headers = @{
        Authorization = "Bearer $accessToken"
    }
    try {
        $coursesResponse = Invoke-RestMethod -Uri "$baseUrl/courses/my/enrolled" -Method Get -Headers $headers
        Write-Host "Success! Fetched enrolled courses:"
        $coursesResponse.data | ConvertTo-Json -Depth 3
    } catch {
        Write-Host "Error fetching courses:" $_.Exception.Response
    }
} else {
    Write-Host "Skipping authenticated request (No token)."
}
