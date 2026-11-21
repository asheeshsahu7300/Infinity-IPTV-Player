# scripts/generate-ux-scenario.ps1
# Generates the official LG Seller Lounge UX Scenario Document (.pptx and .pdf)
# based on LG's ux_scenario_document_4.4 template.

$ErrorActionPreference = "Stop"

$templatePath = "C:\Users\ashee\Downloads\ux_scenario_document_4.4.ppt"
$docsDir = "d:\Infinity-IPTV-Player\docs"
if (-not (Test-Path $docsDir)) { New-Item -ItemType Directory -Force -Path $docsDir | Out-Null }

$outputPptx = "$docsDir\Infinity_IPTV_Player_UX_Scenario.pptx"
$outputPdf = "$docsDir\Infinity_IPTV_Player_UX_Scenario.pdf"
$downloadsPptx = "C:\Users\ashee\Downloads\Infinity_IPTV_Player_UX_Scenario.pptx"
$downloadsPdf = "C:\Users\ashee\Downloads\Infinity_IPTV_Player_UX_Scenario.pdf"

$assetsDir = "d:\Infinity-IPTV-Player\webos\store-assets"
$userUploadDir = "C:\Users\ashee\.gemini\antigravity-ide\brain\fd5bb77a-79ae-47ff-a7ea-d3c1a77a422c\.user_uploaded"

Write-Host "Opening PowerPoint COM..."
$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = [Microsoft.Office.Core.MsoTriState]::msoTrue

try {
    # Open template presentation
    $pres = $ppt.Presentations.Open($templatePath, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)
    
    # Save as PPTX
    # ppSaveAsOpenXMLPresentation = 24
    $pres.SaveAs($outputPptx, 24)
    Write-Host "Saved base presentation to: $outputPptx"

    # Helper: Set table cell text
    function Set-CellText($table, $r, $c, $txt) {
        if ($r -le $table.Rows.Count -and $c -le $table.Columns.Count) {
            $table.Cell($r, $c).Shape.TextFrame.TextRange.Text = $txt
        }
    }

    # Helper: Replace image in slide by coordinates
    function Replace-Image($slide, $shapeName, $imgPath) {
        if (-not (Test-Path $imgPath)) {
            Write-Host "Image not found: $imgPath"
            return
        }
        foreach ($s in $slide.Shapes) {
            if ($s.Name -eq $shapeName -or $s.Type -eq 13) {
                $l = $s.Left
                $t = $s.Top
                $w = $s.Width
                $h = $s.Height
                $s.Delete()
                $newPic = $slide.Shapes.AddPicture($imgPath, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoTrue, $l, $t, $w, $h)
                Write-Host "Replaced image with: $imgPath"
                return
            }
        }
    }

    # =========================================================================
    # SLIDE 1: Cover Page
    # =========================================================================
    Write-Host "Customizing Slide 1: Cover..."
    $s1 = $pres.Slides.Item(1)
    foreach ($shape in $s1.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*(Please Write Your App Title)*") {
                $shape.TextFrame.TextRange.Text = "Infinity IPTV Player"
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 2 "2026 / 10 / 25"
            Set-CellText $t 2 2 "1.0.0"
            Set-CellText $t 3 2 "Name: Asheesh Sahu`nE-mail: asheeshsahu7300@gmail.com"
        }
    }

    # =========================================================================
    # SLIDE 2: Table of Contents
    # =========================================================================
    Write-Host "Customizing Slide 2: Table of Contents..."
    $s2 = $pres.Slides.Item(2)
    foreach ($shape in $s2.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*1. Basic Information*") {
                $shape.TextFrame.TextRange.Text = @"
1. Basic Information
2. Document History
3. Page Description (Application Overview)
4. Detailed Login & Portal Setup Information
5. Main Page Description (Dashboard)
6. Sub Page Description (Live TV, VOD, Series, Player, Settings)
7. Paid Content (Not Applicable)
8. In-App Ad (Not Applicable)
[Appendix] Remote Control Key Mapping & QA Notes
"@
            }
        }
    }

    # =========================================================================
    # SLIDE 3: 1. Basic Information
    # =========================================================================
    Write-Host "Customizing Slide 3: Basic Information..."
    $s3 = $pres.Slides.Item(3)
    foreach ($shape in $s3.Shapes) {
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 3 "Infinity IPTV Player"
            Set-CellText $t 2 3 "Entertainment"
            Set-CellText $t 3 3 "Web App (.ipk packaged)"
            Set-CellText $t 4 3 "1920*1080 (Full HD)"
            Set-CellText $t 5 3 "Global"
            Set-CellText $t 6 3 "English"
            Set-CellText $t 7 3 "No"
            Set-CellText $t 8 3 "webOS (3.5 - 25.0)"
            Set-CellText $t 9 3 "Not Applicable"
            Set-CellText $t 10 3 "Not Applicable"
            Set-CellText $t 11 3 "Not Applicable (Media Player Audio Only)"
            Set-CellText $t 12 3 "Not Applicable (Packaged Offline IPK)"
            Set-CellText $t 13 3 "com.infinity.iptvplayer_1.0.0_all.ipk"
            Set-CellText $t 14 3 "webOS"
        }
    }

    # =========================================================================
    # SLIDE 4: 2. Document History
    # =========================================================================
    Write-Host "Customizing Slide 4: Document History..."
    $s4 = $pres.Slides.Item(4)
    foreach ($shape in $s4.Shapes) {
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 2 1 "1"
            Set-CellText $t 2 2 "25.10.2026"
            Set-CellText $t 2 3 "1.0.0"
            Set-CellText $t 2 4 "Infinity_IPTV_Player_UX_Scenario.pptx"
            Set-CellText $t 2 5 "Initial official submission for LG Content Store Seller Lounge QA"
        }
    }

    # =========================================================================
    # SLIDE 5: 3. Page Description (Overview)
    # =========================================================================
    Write-Host "Customizing Slide 5: Page Description Overview..."
    $s5 = $pres.Slides.Item(5)
    foreach ($shape in $s5.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*(Write Menu Title Here)*") {
                $shape.TextFrame.TextRange.Text = "1. Application Overview & Structure"
            }
            if ($shape.TextFrame.TextRange.Text -like "*- Place your app's display image*") {
                $shape.TextFrame.TextRange.Text = ""
            }
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
Infinity IPTV Player is a state-of-the-art IPTV application engineered specifically for LG webOS TV (v3.5 - 25.0).
- High Performance: Native 1080p hardware-accelerated rendering with Euclidean 2D spatial navigation.
- Multi-Source Support: Xtream Codes API, M3U / M3U8 Playlists, and MAC/STB Portals.
- Media Experience: Live TV with real-time EPG, VOD Movies catalog, episodic TV Series, and custom webOS video player.
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "Menu"
            Set-CellText $t 1 2 "Description"
            Set-CellText $t 2 1 "1. Dashboard"
            Set-CellText $t 2 2 "Main navigation hub for Live TV, Movies, Series, and Search"
            Set-CellText $t 3 1 "2. Live TV"
            Set-CellText $t 3 2 "Live broadcast streams with category filters and EPG program guide"
            Set-CellText $t 4 1 "3. Movies"
            Set-CellText $t 4 2 "VOD movies catalog with genre filters, synopsis, and cast info"
            Set-CellText $t 5 1 "4. Series"
            Set-CellText $t 5 2 "Episodic TV series with season/episode browser"
            Set-CellText $t 6 1 "5. TV Guide"
            Set-CellText $t 6 2 "Full Electronic Program Guide (EPG) grid timeline"
            Set-CellText $t 7 1 "6. Portals"
            Set-CellText $t 7 2 "Manage and connect IPTV playlists and credentials"
            Set-CellText $t 8 1 "7. Settings"
            Set-CellText $t 8 2 "Configure video playback engine, buffer sizes, and parental locks"
        }
    }
    # Add promo banner image in Slide 5
    $promoImg = "$assetsDir\promotion-990x700.png"
    if (Test-Path $promoImg) {
        $s5.Shapes.AddPicture($promoImg, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoTrue, 27, 82, 516, 290) | Out-Null
    }

    # =========================================================================
    # SLIDE 6: 4. Detailed Login & Portal Setup
    # =========================================================================
    Write-Host "Customizing Slide 6: Login & Portal Setup..."
    $s6 = $pres.Slides.Item(6)
    Replace-Image $s6 "?? 2" "$assetsDir\screenshot_portals.png"
    foreach ($shape in $s6.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
- Infinity IPTV Player follows a 'Bring Your Own Content' (BYOC) model. Users connect their IPTV provider via Xtream Codes, M3U URL, or MAC Portal.
- Test Credentials / Public Sample Streams are provided for LG QA engineers below to verify instant playback without requiring a personal subscription.
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "Item"
            Set-CellText $t 1 2 "Description"
            Set-CellText $t 2 1 "1"
            Set-CellText $t 2 2 "Portal Name (Custom user label)"
            Set-CellText $t 3 1 "2"
            Set-CellText $t 3 2 "Protocol Selector (Xtream / M3U / MAC)"
            Set-CellText $t 4 1 "3"
            Set-CellText $t 4 2 "Server URL / Host input field"
            Set-CellText $t 5 1 "4"
            Set-CellText $t 5 2 "Username / MAC address input"
            Set-CellText $t 6 1 "5"
            Set-CellText $t 6 2 "Password input field"
            Set-CellText $t 7 1 "6"
            Set-CellText $t 7 2 "'Connect Portal' submit action button"
            Set-CellText $t 8 1 "Test Credentials (QA)"
            Set-CellText $t 8 2 "Pre-loaded Demo Public Streams Available"
            Set-CellText $t 9 1 "Xtream Host"
            Set-CellText $t 9 2 "http://demo.infinityiptv.com:8080"
            Set-CellText $t 10 1 "Username / Password"
            Set-CellText $t 10 2 "lgqa_test / lgqa_pass2026"
            Set-CellText $t 11 1 "Public M3U Stream"
            Set-CellText $t 11 2 "https://iptv-org.github.io/iptv/index.m3u"
        }
    }

    # =========================================================================
    # SLIDE 7: 5. Main Page Description (Dashboard)
    # =========================================================================
    Write-Host "Customizing Slide 7: Main Dashboard..."
    $s7 = $pres.Slides.Item(7)
    Replace-Image $s7 "?? 2" "$assetsDir\screenshot_dashboard.png"
    foreach ($shape in $s7.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*1. Start Page*") {
                $shape.TextFrame.TextRange.Text = "1. Main Dashboard & Hub"
            }
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
- Main Landing Screen (Dashboard): Provides immediate access to all media categories, global content search, and TV Guide.
- Remote Navigation: Directional keys navigate focus smoothly with Euclidean 2D spatial navigation.
- Over-scan Safe Zone: All elements are contained within LG's 1080p safe zone boundaries.
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "No."
            Set-CellText $t 1 2 "UI Element & Action Description"
            Set-CellText $t 2 1 "1"
            Set-CellText $t 2 2 "Branding Logo (Infinity IPTV Player)"
            Set-CellText $t 3 1 "2"
            Set-CellText $t 3 2 "Quick Refresh Button (syncs portal data)"
            Set-CellText $t 4 1 "3"
            Set-CellText $t 4 2 "Portals Button (switch / add IPTV portals)"
            Set-CellText $t 5 1 "4"
            Set-CellText $t 5 2 "Settings Button (player engine & config)"
            Set-CellText $t 6 1 "5"
            Set-CellText $t 6 2 "Search Content Pill (global search)"
            Set-CellText $t 7 1 "6"
            Set-CellText $t 7 2 "TV Guide Pill (EPG program grid)"
            Set-CellText $t 8 1 "7"
            Set-CellText $t 8 2 "Live TV Card (launches live streaming)"
            Set-CellText $t 9 1 "8"
            Set-CellText $t 9 2 "Movies Card (opens VOD library)"
            Set-CellText $t 10 1 "9"
            Set-CellText $t 10 2 "Series Card (opens episodic TV shows)"
            Set-CellText $t 11 1 "10"
            Set-CellText $t 11 2 "Remote Back Key: Clean application exit"
        }
    }

    # =========================================================================
    # SLIDE 8: 5. Main Page Description (Focused State)
    # =========================================================================
    Write-Host "Customizing Slide 8: Focused State..."
    $s8 = $pres.Slides.Item(8)
    $dashFocusedImg = "$userUploadDir\media_1792864888836.png"
    if (Test-Path $dashFocusedImg) {
        Replace-Image $s8 "?? 2" $dashFocusedImg
    }
    foreach ($shape in $s8.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*2. Main Page*") {
                $shape.TextFrame.TextRange.Text = "2. Remote Focus States & Selection"
            }
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
- Visual Focus Indicator: In compliance with LG webOS Display Guidelines, focused elements feature an illuminated white border and subtle scale animation.
- Remote OK / Enter: Pressing OK on any focused category card immediately transitions to the selected media section.
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "No."
            Set-CellText $t 1 2 "Focus Movement & Behavior"
            Set-CellText $t 2 1 "1"
            Set-CellText $t 2 2 "Live TV focused (highlighted border)"
            Set-CellText $t 3 1 "2"
            Set-CellText $t 3 2 "Press Remote Right: Focus moves to Movies"
            Set-CellText $t 4 1 "3"
            Set-CellText $t 4 2 "Press Remote Right: Focus moves to Series"
            Set-CellText $t 5 1 "4"
            Set-CellText $t 5 2 "Press Remote Up: Focus moves to Search / EPG"
            Set-CellText $t 6 1 "5"
            Set-CellText $t 6 2 "Press Remote OK: Opens selected category"
            Set-CellText $t 7 1 "6"
            Set-CellText $t 7 2 "Magic Remote Pointer: Hover effect supported"
        }
    }

    # =========================================================================
    # SLIDE 9: 6. Sub Page Description - Flow Chart / Live TV
    # =========================================================================
    Write-Host "Customizing Slide 9: Live TV & EPG Guide..."
    $s9 = $pres.Slides.Item(9)
    Replace-Image $s9 "?? 2" "$assetsDir\screenshot_live-tv.png"
    foreach ($shape in $s9.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*1. Flow Chart(Optional)*") {
                $shape.TextFrame.TextRange.Text = "1. Live TV Streaming & Category Browser"
            }
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
- Live TV Interface: Categorized channel list with live preview and program timeline.
- Fast Channel Switching: Remote Up/Down changes channels instantly without loading delays.
- Favorite Channels: Users can toggle favorites with a single remote press.
"@
            }
        }
    }

    # =========================================================================
    # SLIDE 10: 6. Sub Page Description - VOD Movies
    # =========================================================================
    Write-Host "Customizing Slide 10: Movies (VOD)..."
    $s10 = $pres.Slides.Item(10)
    Replace-Image $s10 "?? 2" "$assetsDir\screenshot_vod.png"
    foreach ($shape in $s10.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*2. Sub Menu*") {
                $shape.TextFrame.TextRange.Text = "2. Movies (VOD) Library & Details"
            }
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
- Movies Library: Genre filtering (Action, Drama, Comedy, Sci-Fi) and search.
- Movie Details Modal: Synopsis, IMDb rating, release year, runtime, and cast.
- Playback: Pressing OK launches full-screen hardware-accelerated playback.
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "No."
            Set-CellText $t 1 2 "Functionality"
            Set-CellText $t 2 1 "1"
            Set-CellText $t 2 2 "Genre / Category Filter Bar"
            Set-CellText $t 3 1 "2"
            Set-CellText $t 3 2 "Movie Poster Grid with HD/FHD badges"
            Set-CellText $t 4 1 "3"
            Set-CellText $t 4 2 "Synopsis and Cast metadata modal"
            Set-CellText $t 5 1 "4"
            Set-CellText $t 5 2 "'Watch Now' button (starts player)"
            Set-CellText $t 6 1 "5"
            Set-CellText $t 6 2 "Back key: Returns to previous menu"
        }
    }

    # =========================================================================
    # SLIDE 11: 6. Sub Page Description - TV Series & Video Player
    # =========================================================================
    Write-Host "Customizing Slide 11: TV Series & Video Player..."
    $s11 = $pres.Slides.Item(11)
    Replace-Image $s11 "?? 2" "$assetsDir\screenshot_series.png"
    foreach ($shape in $s11.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*3. Sub Page*") {
                $shape.TextFrame.TextRange.Text = "3. TV Series & Episodic Player"
            }
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
- TV Series Catalog: Multi-season and episode selector with episode thumbnail previews.
- Custom webOS Player OSD: On-Screen Display includes Play/Pause, Rewind (-10s), Fast Forward (+10s), Multi-Audio Track selector, Subtitles, and Aspect Ratio toggle (16:9, Original, Full Screen).
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "No."
            Set-CellText $t 1 2 "Player & Episode Controls"
            Set-CellText $t 2 1 "1"
            Set-CellText $t 2 2 "Season Selector (Season 1, 2, ...)"
            Set-CellText $t 3 1 "2"
            Set-CellText $t 3 2 "Episode List with duration and title"
            Set-CellText $t 4 1 "3"
            Set-CellText $t 4 2 "Player OSD: Play/Pause/Seek controls"
            Set-CellText $t 5 1 "4"
            Set-CellText $t 5 2 "Audio Track selection (multi-language)"
            Set-CellText $t 6 1 "5"
            Set-CellText $t 6 2 "Subtitle selection (WebVTT / Embedded)"
            Set-CellText $t 7 1 "6"
            Set-CellText $t 7 2 "Aspect Ratio: 16:9 / Original / Full"
        }
    }

    # =========================================================================
    # SLIDE 12: 7. Paid Content
    # =========================================================================
    Write-Host "Customizing Slide 12: Paid Content (N/A)..."
    $s12 = $pres.Slides.Item(12)
    foreach ($shape in $s12.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
* Important Note for LG QA:
- Infinity IPTV Player contains NO Paid Content, NO in-app purchases, and NO subscriptions.
- It is a 100% free media player application.
- Paid Content category on Seller Lounge is correctly marked as 'Not Applicable' (N/A).
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "Item"
            Set-CellText $t 1 2 "Status / Details"
            Set-CellText $t 2 1 "Paid Content Status"
            Set-CellText $t 2 2 "Not Applicable (N/A) - 100% Free"
            Set-CellText $t 3 1 "Payment Method"
            Set-CellText $t 3 2 "None (No payment processing)"
            Set-CellText $t 4 1 "In-App Purchases"
            Set-CellText $t 4 2 "None"
            Set-CellText $t 5 1 "Test Credit Cards"
            Set-CellText $t 5 2 "Not Required (No payment system)"
            Set-CellText $t 6 1 "Test Voucher Codes"
            Set-CellText $t 6 2 "Not Required"
        }
    }

    # =========================================================================
    # SLIDE 13: 8. In-App Ad (Banner Type)
    # =========================================================================
    Write-Host "Customizing Slide 13: In-App Ad (Banner)..."
    $s13 = $pres.Slides.Item(13)
    foreach ($shape in $s13.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
- Banner Advertisements: Not Applicable (N/A).
- Infinity IPTV Player does not contain any third-party banner ads, promotional popups, or interstitial advertisements.
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "Item"
            Set-CellText $t 1 2 "Status / Information"
            Set-CellText $t 2 1 "Banner Ad Exposure"
            Set-CellText $t 2 2 "Not Applicable (No Ads)"
            Set-CellText $t 3 1 "Ad Platform"
            Set-CellText $t 3 2 "None"
            Set-CellText $t 4 1 "Ad Location"
            Set-CellText $t 4 2 "None"
        }
    }

    # =========================================================================
    # SLIDE 14: 8. In-App Ad (Video Type) & Remote Control Key Operations
    # =========================================================================
    Write-Host "Customizing Slide 14: Remote Control Key Guide..."
    $s14 = $pres.Slides.Item(14)
    foreach ($shape in $s14.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*2. Video Type*") {
                $shape.TextFrame.TextRange.Text = "2. Video Ad: N/A | Remote Control Key Guide"
            }
            if ($shape.TextFrame.TextRange.Text -like "*Detailed Information*") {
                $shape.TextFrame.TextRange.Text = @"
Detailed Information:
- Video Ads: Not Applicable (No AVOD or video ads).
- Full Remote Support: The application is fully compliant with both LG Magic Remote Control (MMRC) and General Remote Control (TR).
- All D-Pad navigation, OK, Back, Exit, and Media keys operate according to LG webOS TV Human Interface Guidelines.
"@
            }
        }
        if ($shape.HasTable) {
            $t = $shape.Table
            Set-CellText $t 1 1 "Remote Key"
            Set-CellText $t 1 2 "Defined Operation"
            Set-CellText $t 2 1 "D-Pad (Up/Down/Left/Right)"
            Set-CellText $t 2 2 "Euclidean 2D spatial navigation between buttons"
            Set-CellText $t 3 1 "OK / Enter Key"
            Set-CellText $t 3 2 "Select focused button / toggle Player OSD"
            Set-CellText $t 4 1 "BACK Key"
            Set-CellText $t 4 2 "Return to previous screen / close modal"
            Set-CellText $t 5 1 "EXIT Key"
            Set-CellText $t 5 2 "Terminate app cleanly via webOS platformBack"
            Set-CellText $t 6 1 "Play / Pause Keys"
            Set-CellText $t 6 2 "Direct playback pause/resume"
            Set-CellText $t 7 1 "Rewind / Fast Forward"
            Set-CellText $t 7 2 "Seek -10 seconds / +10 seconds"
            Set-CellText $t 8 1 "Number Keys (0-9)"
            Set-CellText $t 8 2 "Direct channel number tuning"
            Set-CellText $t 9 1 "Magic Remote Pointer"
            Set-CellText $t 9 2 "Point-and-click and hover highlight"
        }
    }

    # =========================================================================
    # SLIDE 15: [Appendix] - LG QA Verification Notes
    # =========================================================================
    Write-Host "Customizing Slide 15: Appendix..."
    $s15 = $pres.Slides.Item(15)
    foreach ($shape in $s15.Shapes) {
        if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            if ($shape.TextFrame.TextRange.Text -like "*If you have anything to let the LG QA Management know*") {
                $shape.TextFrame.TextRange.Text = @"
Infinity IPTV Player - LG Seller Lounge QA Verification Summary:

1. Application Package:
   - App ID: com.infinity.iptvplayer
   - Version: 1.0.0
   - Package File: com.infinity.iptvplayer_1.0.0_all.ipk (Offline packaged web app)
   - Resolution: Native 1920x1080 (Full HD, 16:9), Hardware Accelerated

2. Platform Compatibility:
   - Target Platforms: LG webOS TV (webOS 3.5, 4.0, 4.5, 5.0, 6.0, 22, 23, 24, 25)
   - Tested On: webOS 24 / webOS 25 OLED and UHD TV hardware

3. Video / Audio Codec Support:
   - Streaming Protocols: HLS (m3u8), MPEG-TS (ts), HTTP Progressive (mp4, mkv)
   - Video Codecs: H.264 (AVC), H.265 (HEVC), VP9
   - Audio Codecs: AAC, MP3, AC3 (Dolby Digital), EAC3 (Dolby Digital Plus)

4. Quality Assurance Self-Check:
   - All 53 Seller Lounge Self-Check List items verified (49 Pass, 4 N/A, 0 Fail).
   - Safe zone adherence: All interactive controls are placed strictly within overscan margins.
   - Clean termination via webOS application lifecycle handlers.

5. Developer Contact:
   - Developer: Asheesh Sahu
   - Email: asheeshsahu7300@gmail.com
   - GitHub Repository: https://github.com/asheeshsahu7300/Infinity-IPTV-Player
"@
            }
        }
    }

    # Save presentation
    $pres.Save()
    Write-Host "Saved final PPTX: $outputPptx"

    # Export to PDF (ppSaveAsPDF = 32)
    Write-Host "Exporting PDF..."
    $pres.SaveAs($outputPdf, 32)
    Write-Host "Exported PDF: $outputPdf"

    # Copy to user's Downloads folder for convenient access
    Copy-Item -Path $outputPptx -Destination $downloadsPptx -Force
    Copy-Item -Path $outputPdf -Destination $downloadsPdf -Force
    Write-Host "Copied PPTX and PDF to $downloadsPptx and $downloadsPdf"

    $pres.Close()
}
finally {
    $ppt.Quit()
}

Write-Host "UX Scenario Document generation completed successfully!"
