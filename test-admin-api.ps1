$baseUrl = "https://mastermock-backend-5.onrender.com/api/v1"

# Or if you are running locally, uncomment the line below:
# $baseUrl = "http://localhost:3000/api/v1"

$adminEmail = "admin@example.com"
$adminPassword = "AdminPassword123!"

Write-Host "============================================="
Write-Host "           ADMIN API TEST SCRIPT             "
Write-Host "============================================="

Write-Host "`n--- 1. Logging in as Admin ---"
$loginBody = @{
    email = $adminEmail
    password = $adminPassword
} | ConvertTo-Json

$accessToken = $null

try {
    $loginResponse = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    Write-Host "Success! Admin Logged In."
    $accessToken = $loginResponse.data.accessToken
} catch {
    Write-Host "Error logging in:" $_.Exception.Response
    exit
}

$headers = @{
    Authorization = "Bearer $accessToken"
}

Write-Host "`n--- 2. Fetching Admin Dashboard ---"
try {
    $dashboardResponse = Invoke-RestMethod -Uri "$baseUrl/dashboard/admin" -Method Get -Headers $headers
    Write-Host "Success! Admin Dashboard data:"
    $dashboardResponse.data | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Error fetching dashboard:" $_.Exception.Response
}

Write-Host "`n--- 3. Creating a New Category ---"
$timestamp = Get-Date -UFormat "%s"
$categoryBody = @{
    name = "Test Category $timestamp"
    description = "This is a test category created by the admin script."
} | ConvertTo-Json

$categoryId = $null

try {
    $categoryResponse = Invoke-RestMethod -Uri "$baseUrl/categories" -Method Post -Body $categoryBody -ContentType "application/json" -Headers $headers
    Write-Host "Success! Category Created:"
    $categoryResponse.data | ConvertTo-Json -Depth 3
    $categoryId = $categoryResponse.data._id
} catch {
    Write-Host "Error creating category:" $_.Exception.Response
}

Write-Host "`n--- 4. Creating a New Course ---"
if ($categoryId) {
    $courseBody = @{
        title = "Test Admin Course $timestamp"
        description = "This course was created by the admin test script."
        price = 199
        access_type = "paid"
        category = $categoryId
    } | ConvertTo-Json

    try {
        $courseResponse = Invoke-RestMethod -Uri "$baseUrl/courses" -Method Post -Body $courseBody -ContentType "application/json" -Headers $headers
        Write-Host "Success! Course Created:"
        $courseResponse.data | ConvertTo-Json -Depth 3
    } catch {
        Write-Host "Error creating course:" $_.Exception.Response
    }
} else {
    Write-Host "Skipping Course Creation: Category ID not available."
}

Write-Host "`n============================================="
Write-Host "             TEST SCRIPT FINISHED            "
Write-Host "============================================="
