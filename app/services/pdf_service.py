import io
import datetime
import json
import re
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from app.config import settings


def sanitize_pdf_filename_part(text: str) -> str:
    """Sanitize string for safe filenames across Windows, macOS, and Linux."""
    if not text:
        return ""
    # Strip illegal filename characters
    cleaned = re.sub(r'[\\/*?:"<>|]', "", str(text).strip())
    # Replace whitespace sequences with an underscore
    cleaned = re.sub(r'\s+', "_", cleaned)
    # Remove multiple consecutive underscores
    cleaned = re.sub(r'_+', "_", cleaned)
    return cleaned.strip("_")


def build_pdf_filename(patient_name: str, bill_type: str, invoice_or_order_number: str) -> str:
    """
    Format standard hospital bill PDF filename:
    Pattern: {Patient_Name}_{BillType}_Bill_{InvoiceOrOrderNumber}.pdf
    Examples:
      - Rahul_Sharma_Lab_Bill_INV-2026-0055.pdf
      - Priya_Patel_Pharma_Bill_INV-2026-0056.pdf
      - Amit_Verma_Appointment_Bill_INV-2026-0057.pdf
    """
    p_name = sanitize_pdf_filename_part(patient_name) or "Patient"
    b_type = sanitize_pdf_filename_part(bill_type) or "General"
    doc_id = sanitize_pdf_filename_part(invoice_or_order_number) or "Receipt"
    return f"{p_name}_{b_type}_Bill_{doc_id}.pdf"


def get_clinic_pdf_profile():
    """Retrieve dynamic clinic identity and communication info from backend settings."""
    name = getattr(settings, "CLINIC_NAME", "Aerostate Speciality Clinic") or "Aerostate Speciality Clinic"
    tagline = getattr(settings, "CLINIC_TAGLINE", "Medical Center & OPD Consultation Services") or "Medical Center & OPD Consultation Services"
    reg_no = getattr(settings, "CLINIC_REG_NO", "") or ""
    address = getattr(settings, "CLINIC_ADDRESS", "") or ""
    phone = getattr(settings, "CLINIC_PHONE", "") or ""
    email = getattr(settings, "CLINIC_EMAIL", "") or ""
    hours = getattr(settings, "CLINIC_HOURS", "") or ""

    reg_part = f" • Reg No: {reg_no}" if reg_no else ""
    contact_parts = []
    if address:
        contact_parts.append(address)
    if phone:
        contact_parts.append(f"Phone: {phone}")
    if email:
        contact_parts.append(f"Email: {email}")
    contact_str = " • ".join(contact_parts) if contact_parts else "Healthcare Services"

    return {
        "name": name,
        "tagline": tagline,
        "reg_no": reg_no,
        "reg_part": reg_part,
        "address": address,
        "phone": phone,
        "email": email,
        "hours": hours,
        "contact_str": contact_str,
    }


def generate_diagnostic_receipt_pdf(order, invoice=None) -> bytes:
    """Generate an official high-resolution Diagnostic Receipt PDF in A4 format."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36,
    )
    styles = getSampleStyleSheet()

    # Custom styles
    brand_blue = colors.HexColor("#254d90")
    brand_teal = colors.HexColor("#126868")
    slate_dark = colors.HexColor("#0f172a")
    slate_gray = colors.HexColor("#64748b")
    slate_light = colors.HexColor("#f8fafc")
    border_color = colors.HexColor("#cbd5e1")

    title_style = ParagraphStyle(
        "ClinicTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=brand_blue,
    )
    subtitle_style = ParagraphStyle(
        "ClinicSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        textColor=slate_gray,
    )
    doc_type_style = ParagraphStyle(
        "DocType",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        alignment=2,  # Right aligned
        textColor=slate_dark,
    )
    meta_style = ParagraphStyle(
        "DocMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        alignment=2,
        textColor=slate_gray,
    )
    section_label = ParagraphStyle(
        "SectionLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=brand_blue,
        spaceAfter=2,
    )
    info_text = ParagraphStyle(
        "InfoText",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        textColor=slate_dark,
    )
    info_bold = ParagraphStyle(
        "InfoBold",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.5,
        leading=13,
        textColor=slate_dark,
    )
    table_hdr = ParagraphStyle(
        "TableHdr",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#334155"),
    )
    table_hdr_right = ParagraphStyle(
        "TableHdrRight",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        alignment=2,
        textColor=colors.HexColor("#334155"),
    )
    cell_text = ParagraphStyle(
        "CellText",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=slate_dark,
    )
    cell_right = ParagraphStyle(
        "CellRight",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        alignment=2,
        textColor=slate_dark,
    )
    cell_bold_right = ParagraphStyle(
        "CellBoldRight",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        alignment=2,
        textColor=slate_dark,
    )

    elements = []

    clinic = get_clinic_pdf_profile()

    # 1. Header Banner
    header_data = [
        [
            Paragraph(f"<b>{clinic['name']}</b>", title_style),
            Paragraph("<b>DIAGNOSTIC BILLING RECEIPT</b>", doc_type_style),
        ],
        [
            Paragraph(
                f"{clinic['tagline']}{clinic['reg_part']}<br/>"
                f"{clinic['contact_str']}",
                subtitle_style,
            ),
            Paragraph(
                f"<b>Receipt / Invoice:</b> {invoice.invoice_number if invoice else 'DIRECT-DIAG'}<br/>"
                f"<b>Order UID:</b> {order.order_uid}<br/>"
                f"<b>Date:</b> {datetime.datetime.now().strftime('%d %b %Y, %I:%M %p')}",
                meta_style,
            ),
        ],
    ]
    header_table = Table(header_data, colWidths=[310, 212])
    header_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ])
    )
    elements.append(header_table)
    elements.append(Spacer(1, 10))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=brand_blue, spaceBefore=4, spaceAfter=12))

    # 2. Patient & Clinical Context Block
    patient = getattr(order, "patient", None)
    patient_name = patient.name if patient else "Valued Patient"
    patient_phone = patient.phone if patient else "—"
    patient_uid = getattr(patient, "patient_uid", f"PAT-{getattr(order, 'patient_id', '0')}") if patient else f"PAT-{getattr(order, 'patient_id', '0')}"
    patient_info = f"{getattr(patient, 'gender', 'N/A') or 'N/A'}, {getattr(patient, 'age', 'N/A') or 'N/A'} yrs" if patient else "—"

    doctor_name = getattr(order, "doctor_name", "") or "Attending Physician"
    if doctor_name and not doctor_name.startswith("Dr."):
        doctor_name = f"Dr. {doctor_name}"

    diag_text = getattr(order, "clinical_indication", "") or "Provisional Diagnostic Evaluation"

    info_box_data = [
        [
            Paragraph("PATIENT DETAILS", section_label),
            Paragraph("PRESCRIBING DOCTOR &amp; DIAGNOSIS", section_label),
        ],
        [
            Paragraph(f"<b>{patient_name}</b> ({patient_info})", info_bold),
            Paragraph(f"<b>{doctor_name}</b>", info_bold),
        ],
        [
            Paragraph(f"Phone: {patient_phone} • UID: <font name='Helvetica-Bold'>{patient_uid}</font>", info_text),
            Paragraph(f"Diagnosis: {diag_text}", info_text),
        ],
    ]
    info_table = Table(info_box_data, colWidths=[260, 262])
    info_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), slate_light),
            ("BOX", (0, 0), (-1, -1), 0.75, border_color),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ])
    )
    elements.append(info_table)
    elements.append(Spacer(1, 14))

    # 3. Investigation Items Table
    test_rows = []
    try:
        raw_tests = json.loads(order.tests or "[]")
    except Exception:
        raw_tests = []

    subtotal = 0.0
    for idx, t in enumerate(raw_tests, start=1):
        name = t.get("name", f"Investigation #{idx}")
        code = t.get("test_code", "")
        sample = t.get("sample_type", "Specimen")
        tat = f"{t.get('tat_hours', 24)}h"
        price = float(t.get("price", 0))
        subtotal += price

        test_display = f"<b>{name}</b>"
        if code:
            test_display += f" <font color='#64748b' size='8'>[{code}]</font>"

        test_rows.append([
            Paragraph(str(idx), cell_text),
            Paragraph(test_display, cell_text),
            Paragraph(sample, cell_text),
            Paragraph(tat, cell_text),
            Paragraph(f"INR {price:,.2f}", cell_bold_right),
        ])

    if not test_rows:
        test_rows.append([
            Paragraph("1", cell_text),
            Paragraph("Diagnostic Investigations Ordered", cell_text),
            Paragraph("Clinical Specimen", cell_text),
            Paragraph("24h", cell_text),
            Paragraph(f"INR {float(order.total_price or 0):,.2f}", cell_bold_right),
        ])
        subtotal = float(order.total_price or 0)

    items_table_data = [
        [
            Paragraph("<b>#</b>", table_hdr),
            Paragraph("<b>INVESTIGATION / TEST CODE</b>", table_hdr),
            Paragraph("<b>SAMPLE TYPE</b>", table_hdr),
            Paragraph("<b>EST. TAT</b>", table_hdr),
            Paragraph("<b>RATE (INR)</b>", table_hdr_right),
        ],
        *test_rows,
    ]
    items_table = Table(items_table_data, colWidths=[28, 254, 110, 50, 80])
    items_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#94a3b8")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 1), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("BOX", (0, 0), (-1, -1), 0.75, border_color),
        ])
    )
    elements.append(items_table)
    elements.append(Spacer(1, 12))

    # 4. Totals & Payment Summary Box
    total_charges = float(invoice.total if invoice else (order.total_price or subtotal))
    amount_paid = float(invoice.amount_paid if invoice else total_charges)
    balance_due = float(invoice.balance_due if invoice else 0.0)
    pay_status = invoice.payment_status if invoice else "PAID"
    pay_method = invoice.payment_method if invoice else "Cash"

    status_color = "#059669" if pay_status == "PAID" else ("#d97706" if pay_status == "PARTIALLY_PAID" else "#dc2626")

    summary_left_content = (
        f"<b>PAYMENT STATUS:</b> <font color='{status_color}'><b>{pay_status}</b></font><br/>"
        f"<b>Payment Mode:</b> {pay_method}<br/>"
        f"<b>Verified By:</b> {clinic['name']} Diagnostic Cashier"
    )

    totals_data = [
        [
            Paragraph(summary_left_content, info_text),
            Paragraph("Subtotal:", cell_right),
            Paragraph(f"INR {subtotal:,.2f}", cell_bold_right),
        ],
        [
            "",
            Paragraph("<b>Total Amount Payable:</b>", cell_right),
            Paragraph(f"<b>INR {total_charges:,.2f}</b>", cell_bold_right),
        ],
        [
            "",
            Paragraph("<b>Amount Collected:</b>", cell_right),
            Paragraph(f"<font color='#059669'><b>INR {amount_paid:,.2f}</b></font>", cell_bold_right),
        ],
        [
            "",
            Paragraph("<b>Balance Due:</b>", cell_right),
            Paragraph(
                f"<font color='{'#dc2626' if balance_due > 0 else '#059669'}'><b>INR {balance_due:,.2f}</b></font>",
                cell_bold_right,
            ),
        ],
    ]

    totals_table = Table(totals_data, colWidths=[260, 150, 112])
    totals_table.setStyle(
        TableStyle([
            ("SPAN", (0, 0), (0, 3)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BACKGROUND", (0, 0), (-1, -1), slate_light),
            ("BOX", (0, 0), (-1, -1), 0.75, border_color),
            ("LINEABOVE", (1, 1), (2, 1), 0.75, border_color),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ])
    )
    elements.append(totals_table)
    elements.append(Spacer(1, 14))

    # Payment Transactions Audit Trail in PDF
    payments_list = getattr(invoice, "payments", []) or []
    if payments_list:
        hdr_tx = ParagraphStyle("HdrTx", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor("#334155"))
        tx_rows = [
            [
                Paragraph("<b>DATE & TIME</b>", table_hdr),
                Paragraph("<b>TX UID</b>", table_hdr),
                Paragraph("<b>PAYMENT MODE</b>", table_hdr),
                Paragraph("<b>COLLECTION REASON / PURPOSE</b>", table_hdr),
                Paragraph("<b>AMOUNT (INR)</b>", table_hdr_right),
            ]
        ]
        for p in payments_list:
            dt_str = p.created_at.strftime("%d %b %Y, %I:%M %p") if getattr(p, "created_at", None) else "-"
            tx_rows.append([
                Paragraph(dt_str, cell_text),
                Paragraph(p.payment_uid, cell_text),
                Paragraph(p.payment_method or "Cash", cell_text),
                Paragraph(p.notes or "Invoice settlement", cell_text),
                Paragraph(f"+INR {float(p.amount):,.2f}", cell_bold_right),
            ])
        tx_table = Table(tx_rows, colWidths=[100, 80, 80, 162, 100])
        tx_table.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#94a3b8")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 1), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("BOX", (0, 0), (-1, -1), 0.75, border_color),
            ])
        )
        elements.append(Paragraph("<b>RECORDED PAYMENT TRANSACTIONS & AUDIT REASONS:</b>", hdr_tx))
        elements.append(Spacer(1, 4))
        elements.append(tx_table)
        elements.append(Spacer(1, 14))

    elements.append(Spacer(1, 10))

    # 5. Signatures and Accreditation Footer
    footer_data = [
        [
            Paragraph(
                f"<i>Thank you for choosing {clinic['name']}.<br/>"
                "Reports will be delivered to patient portal &amp; verified via SMS/WhatsApp.</i>",
                subtitle_style,
            ),
            Paragraph(
                f"<b>For {clinic['name']}</b><br/><br/><br/>"
                "____________________________________<br/>"
                "Authorized Billing Signatory &amp; Stamp",
                meta_style,
            ),
        ]
    ]
    footer_table = Table(footer_data, colWidths=[310, 212])
    footer_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ])
    )
    elements.append(footer_table)

    doc.build(elements)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes


def generate_invoice_pdf(invoice, patient=None) -> bytes:
    """Generate an official A4 PDF for any clinical invoice or pharmacy receipt."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36,
    )
    styles = getSampleStyleSheet()

    brand_blue = colors.HexColor("#254d90")
    slate_dark = colors.HexColor("#0f172a")
    slate_gray = colors.HexColor("#64748b")
    slate_light = colors.HexColor("#f8fafc")
    border_color = colors.HexColor("#cbd5e1")

    title_style = ParagraphStyle(
        "ClinicTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=brand_blue,
    )
    subtitle_style = ParagraphStyle(
        "ClinicSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        textColor=slate_gray,
    )
    doc_type_style = ParagraphStyle(
        "DocType",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        alignment=2,
        textColor=slate_dark,
    )
    meta_style = ParagraphStyle(
        "DocMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        alignment=2,
        textColor=slate_gray,
    )
    section_label = ParagraphStyle(
        "SectionLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=brand_blue,
        spaceAfter=2,
    )
    info_text = ParagraphStyle(
        "InfoText",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        textColor=slate_dark,
    )
    info_bold = ParagraphStyle(
        "InfoBold",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.5,
        leading=13,
        textColor=slate_dark,
    )
    table_hdr = ParagraphStyle(
        "TableHdr",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#334155"),
    )
    table_hdr_right = ParagraphStyle(
        "TableHdrRight",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        alignment=2,
        textColor=colors.HexColor("#334155"),
    )
    cell_text = ParagraphStyle(
        "CellText",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=slate_dark,
    )
    cell_right = ParagraphStyle(
        "CellRight",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        alignment=2,
        textColor=slate_dark,
    )
    cell_bold_right = ParagraphStyle(
        "CellBoldRight",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        alignment=2,
        textColor=slate_dark,
    )

    elements = []

    # Header
    created_dt = invoice.created_at or datetime.datetime.now()
    if isinstance(created_dt, str):
        date_str = created_dt
    else:
        date_str = created_dt.strftime("%d %b %Y, %I:%M %p")

    clinic = get_clinic_pdf_profile()

    header_data = [
        [
            Paragraph(f"<b>{clinic['name']}</b>", title_style),
            Paragraph("<b>OFFICIAL BILLING RECEIPT</b>", doc_type_style),
        ],
        [
            Paragraph(
                f"{clinic['tagline']}{clinic['reg_part']}<br/>"
                f"{clinic['contact_str']}",
                subtitle_style,
            ),
            Paragraph(
                f"<b>Receipt No:</b> {invoice.invoice_number}<br/>"
                f"<b>Date:</b> {date_str}",
                meta_style,
            ),
        ],
    ]
    header_table = Table(header_data, colWidths=[310, 212])
    header_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ])
    )
    elements.append(header_table)
    elements.append(Spacer(1, 10))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=brand_blue, spaceBefore=4, spaceAfter=12))

    # Patient Details
    patient_name = patient.name if patient else "Valued Patient"
    patient_phone = patient.phone if patient else "—"
    patient_uid = getattr(patient, "patient_uid", f"PAT-{getattr(invoice, 'patient_id', '0')}") if patient else f"PAT-{getattr(invoice, 'patient_id', '0')}"
    patient_info = f"{getattr(patient, 'gender', 'N/A') or 'N/A'}, {getattr(patient, 'age', 'N/A') or 'N/A'} yrs" if patient else "—"

    info_box_data = [
        [
            Paragraph("PATIENT DETAILS", section_label),
            Paragraph("INVOICE SUMMARY", section_label),
        ],
        [
            Paragraph(f"<b>{patient_name}</b> ({patient_info})", info_bold),
            Paragraph(f"Invoice Reference: <b>{invoice.invoice_number}</b>", info_bold),
        ],
        [
            Paragraph(f"Phone: {patient_phone} • UID: <font name='Helvetica-Bold'>{patient_uid}</font>", info_text),
            Paragraph(f"Remarks: {invoice.notes or 'Clinical counter services'}", info_text),
        ],
    ]
    info_table = Table(info_box_data, colWidths=[260, 262])
    info_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), slate_light),
            ("BOX", (0, 0), (-1, -1), 0.75, border_color),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ])
    )
    elements.append(info_table)
    elements.append(Spacer(1, 14))

    # Items table
    items_rows = []
    try:
        raw_items = json.loads(invoice.items or "[]")
    except Exception:
        raw_items = []

    subtotal = float(invoice.subtotal or invoice.total or 0)
    for idx, it in enumerate(raw_items, start=1):
        name = it.get("name", it.get("medicine_name", f"Service Item #{idx}"))
        category = it.get("category", "Clinical Service")
        qty = it.get("quantity", 1)
        price = float(it.get("unit_price", it.get("price", 0)))
        tot = float(it.get("total", qty * price))

        items_rows.append([
            Paragraph(str(idx), cell_text),
            Paragraph(f"<b>{name}</b> <font color='#64748b' size='8'>({category})</font>", cell_text),
            Paragraph(str(qty), cell_right),
            Paragraph(f"INR {price:,.2f}", cell_right),
            Paragraph(f"INR {tot:,.2f}", cell_bold_right),
        ])

    if not items_rows:
        items_rows.append([
            Paragraph("1", cell_text),
            Paragraph(invoice.notes or "Clinical Care & Diagnostic Services", cell_text),
            Paragraph("1", cell_right),
            Paragraph(f"INR {float(invoice.total or 0):,.2f}", cell_right),
            Paragraph(f"INR {float(invoice.total or 0):,.2f}", cell_bold_right),
        ])

    table_data = [
        [
            Paragraph("<b>#</b>", table_hdr),
            Paragraph("<b>ITEM / CLINICAL SERVICE DESCRIPTION</b>", table_hdr),
            Paragraph("<b>QTY</b>", table_hdr_right),
            Paragraph("<b>RATE (INR)</b>", table_hdr_right),
            Paragraph("<b>TOTAL (INR)</b>", table_hdr_right),
        ],
        *items_rows,
    ]
    table = Table(table_data, colWidths=[28, 264, 40, 90, 100])
    table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#94a3b8")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 1), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("BOX", (0, 0), (-1, -1), 0.75, border_color),
        ])
    )
    elements.append(table)
    elements.append(Spacer(1, 12))

    # Totals
    total_charges = float(invoice.total or 0)
    amount_paid = float(invoice.amount_paid or 0)
    balance_due = float(invoice.balance_due if invoice.balance_due is not None else 0.0)
    pay_status = invoice.payment_status or "PAID"
    pay_method = invoice.payment_method or "Cash"

    status_color = "#059669" if pay_status == "PAID" else ("#d97706" if pay_status == "PARTIALLY_PAID" else "#dc2626")

    summary_left_content = (
        f"<b>PAYMENT STATUS:</b> <font color='{status_color}'><b>{pay_status}</b></font><br/>"
        f"<b>Payment Mode:</b> {pay_method}<br/>"
        f"<b>Cashier / Counter:</b> Main Reception &amp; Cashier"
    )

    totals_data = [
        [
            Paragraph(summary_left_content, info_text),
            Paragraph("Subtotal:", cell_right),
            Paragraph(f"INR {subtotal:,.2f}", cell_bold_right),
        ],
        [
            "",
            Paragraph("<b>Total Amount Payable:</b>", cell_right),
            Paragraph(f"<b>INR {total_charges:,.2f}</b>", cell_bold_right),
        ],
        [
            "",
            Paragraph("<b>Amount Collected:</b>", cell_right),
            Paragraph(f"<font color='#059669'><b>INR {amount_paid:,.2f}</b></font>", cell_bold_right),
        ],
        [
            "",
            Paragraph("<b>Balance Due:</b>", cell_right),
            Paragraph(
                f"<font color='{'#dc2626' if balance_due > 0 else '#059669'}'><b>INR {balance_due:,.2f}</b></font>",
                cell_bold_right,
            ),
        ],
    ]

    totals_table = Table(totals_data, colWidths=[260, 150, 112])
    totals_table.setStyle(
        TableStyle([
            ("SPAN", (0, 0), (0, 3)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BACKGROUND", (0, 0), (-1, -1), slate_light),
            ("BOX", (0, 0), (-1, -1), 0.75, border_color),
            ("LINEABOVE", (1, 1), (2, 1), 0.75, border_color),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ])
    )
    elements.append(totals_table)
    elements.append(Spacer(1, 14))

    # Payment Transactions Audit Trail in PDF
    payments_list = getattr(invoice, "payments", []) or []
    if payments_list:
        hdr_tx = ParagraphStyle("HdrTx", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor("#334155"))
        tx_rows = [
            [
                Paragraph("<b>DATE & TIME</b>", table_hdr),
                Paragraph("<b>TX UID</b>", table_hdr),
                Paragraph("<b>PAYMENT MODE</b>", table_hdr),
                Paragraph("<b>COLLECTION REASON / PURPOSE</b>", table_hdr),
                Paragraph("<b>AMOUNT (INR)</b>", table_hdr_right),
            ]
        ]
        for p in payments_list:
            dt_str = p.created_at.strftime("%d %b %Y, %I:%M %p") if getattr(p, "created_at", None) else "-"
            tx_rows.append([
                Paragraph(dt_str, cell_text),
                Paragraph(p.payment_uid, cell_text),
                Paragraph(p.payment_method or "Cash", cell_text),
                Paragraph(p.notes or "Invoice settlement", cell_text),
                Paragraph(f"+INR {float(p.amount):,.2f}", cell_bold_right),
            ])
        tx_table = Table(tx_rows, colWidths=[100, 80, 80, 162, 100])
        tx_table.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#94a3b8")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 1), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("BOX", (0, 0), (-1, -1), 0.75, border_color),
            ])
        )
        elements.append(Paragraph("<b>RECORDED PAYMENT TRANSACTIONS & AUDIT REASONS:</b>", hdr_tx))
        elements.append(Spacer(1, 4))
        elements.append(tx_table)
        elements.append(Spacer(1, 14))

    elements.append(Spacer(1, 10))

    # Footer
    footer_data = [
        [
            Paragraph(
                f"<i>Thank you for trusting {clinic['name']}.<br/>"
                "For queries regarding this receipt, please contact reception.</i>",
                subtitle_style,
            ),
            Paragraph(
                f"<b>For {clinic['name']}</b><br/><br/><br/>"
                "____________________________________<br/>"
                "Authorized Billing Signatory &amp; Stamp",
                meta_style,
            ),
        ]
    ]
    footer_table = Table(footer_data, colWidths=[310, 212])
    footer_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ])
    )
    elements.append(footer_table)

    doc.build(elements)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes
